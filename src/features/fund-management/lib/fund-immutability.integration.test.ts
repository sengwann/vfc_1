import { describe, expect, it } from "vitest";
import { activate, check, fixture, pay } from "./fund-schema-test-support";

describe.skipIf(!process.env.TEST_DATABASE_URL)("Fund lifecycle and immutable history", () => {
  it("rejects closure with an unpaid assessment", async () => {
    await fixture(async (db, id) => {
      await activate(db, id);
      await db.query(`UPDATE "Fund" SET status='CLOSED',"closedAt"=now(),"closedByUserId"=$1,"termsVersion"=3 WHERE id=$1`, [id]);
      await expect(check(db)).rejects.toMatchObject({ message: "VFC_SNAPSHOT_OR_CLOSURE_INVALID" });
    });
  });
  it.each([
    `UPDATE "Fund" SET status='ACTIVE',"termsVersion"=4 WHERE id=$1`,
    `UPDATE "Fund" SET "endDate"="endDate"+1,"termsVersion"=4 WHERE id=$1`,
    `UPDATE "Payment" SET status='VOIDED',"voidReason"='Correction' WHERE id=$1`,
    `UPDATE "Receipt" SET status='VOIDED' WHERE id=$1`,
    `UPDATE "FundHouseAssessment" SET "assessmentAmount"=1002 WHERE id=$1`,
    `DELETE FROM "Fund" WHERE id=$1`,
    `DELETE FROM "Payment" WHERE id=$1`,
    `DELETE FROM "Receipt" WHERE id=$1`,
  ])("rejects closed financial mutation: %s", async (sql) => {
    await fixture(async (db, id) => {
      await activate(db, id); await pay(db, id); await check(db);
      await db.query(`UPDATE "Fund" SET status='CLOSED',"closedAt"=now(),"closedByUserId"=$1,"termsVersion"=3 WHERE id=$1`, [id]);
      await check(db);
      await expect(db.query(sql, [id])).rejects.toMatchObject({ message: sql.startsWith("DELETE") ? (sql.includes('"Fund"') ? "Fund history cannot be deleted" : "Financial history cannot be deleted") : "Closed fund is immutable" });
    });
  });
  it.each([
    `UPDATE "House" SET "isActive"=false WHERE id=$1`,
    `UPDATE "House" SET "headOfHouseId"=NULL WHERE id=$1`,
    `UPDATE "User" SET "membershipStatus"='REMOVED',"houseId"=NULL WHERE id=$1`,
    `UPDATE "Village" SET status='SUSPENDED' WHERE id=$1`,
    `UPDATE "Village" SET status='DEACTIVATED' WHERE id=$1`,
  ])("protects active fund lifecycle even after payment: %s", async (sql) => {
    await fixture(async (db, id) => {
      await activate(db, id); await pay(db, id); await check(db);
      await db.query(sql, [id]);
      await expect(check(db)).rejects.toMatchObject({ message: sql.includes('"Village"') ? "VFC_ACTIVE_FUND_VILLAGE_PROTECTED" : "VFC_ACTIVE_HOUSE_HEAD_PROTECTED" });
    });
  });
  it("rejects extending before expiry", async () => {
    await fixture(async (db, id) => {
      await activate(db, id); await check(db);
      expect((await db.query("SHOW plpgsql.variable_conflict")).rows[0]["plpgsql.variable_conflict"]).toBe("error");
      await expect(db.query(`INSERT INTO "FundEndDateExtension"(id,"fundId","villageId","previousEndDate","newEndDate","previousTermsVersion","newTermsVersion","changedByUserId",reason)
        SELECT id,id,"villageId","endDate","endDate"+1,2,3,$1,'Needs time' FROM "Fund" WHERE id=$1`, [id])).rejects.toMatchObject({ message: "Invalid end-date extension" });
    });
  });
  it("requires matching extension history for active end-date changes", async () => {
    await fixture(async (db, id) => {
      await activate(db, id); await check(db);
      await db.query(`UPDATE "Fund" SET "endDate"="endDate"+1,"termsVersion"=3 WHERE id=$1`, [id]);
      await expect(check(db)).rejects.toMatchObject({ message: "End-date change requires matching extension history" });
    });
  });
  it("keeps financial audits append-only", async () => {
    await fixture(async (db, id) => {
      await db.query(`INSERT INTO "AuditLog"(id,"fundId","villageId","actorUserId","actionType","entityType","entityId") VALUES ($1,$1,$1,$1,'CREATE','FUND',$1)`, [id]);
      await expect(db.query('DELETE FROM "AuditLog" WHERE id=$1', [id])).rejects.toMatchObject({ message: "Financial audit history is append-only" });
    });
  });
  it("records and applies an expired unpaid fund extension atomically", async () => {
    await fixture(async (db, id) => {
      expect((await db.query("SHOW plpgsql.variable_conflict")).rows[0]["plpgsql.variable_conflict"]).toBe("error");
      await db.query(`UPDATE "Fund" SET "endDate"=(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date-1,"termsVersion"=2 WHERE id=$1`, [id]);
      await db.query(`INSERT INTO "FundHouseAssessment"(id,"fundId","houseId","villageId","assessmentAmount","houseNumberSnapshot") VALUES ($1,$1,$1,$1,1001,'H1')`, [id]);
      await db.query(`UPDATE "Fund" SET status='ACTIVE',"eligibleHouseCount"=1,"assessmentPerHouse"=1001,"snapshotAt"=now(),"termsVersion"=3 WHERE id=$1`, [id]);
      await check(db);
      await db.query(`INSERT INTO "FundEndDateExtension"(id,"fundId","villageId","previousEndDate","newEndDate","previousTermsVersion","newTermsVersion","changedByUserId",reason)
        SELECT id,id,"villageId","endDate","endDate"+2,3,4,$1,'Needs time' FROM "Fund" WHERE id=$1`, [id]);
      await db.query(`UPDATE "Fund" SET "endDate"="endDate"+2,"termsVersion"=4 WHERE id=$1`, [id]);
      await check(db);
      await pay(db, id); await check(db);
    });
  });
  it("permits a valid head replacement and ordinary member departure", async () => {
    await fixture(async (db, id) => {
      await activate(db, id); await check(db);
      const member = id + '-member';
      await db.query(`INSERT INTO "User"(id,"villageId","houseId","membershipStatus",name,"passwordHash","updatedAt") VALUES ($2,$1,$1,'ACTIVE','Member','unused',now())`, [id, member]);
      await db.query(`UPDATE "House" SET "headOfHouseId"=$2 WHERE id=$1`, [id, member]);
      await db.query(`UPDATE "User" SET "houseId"=NULL,"membershipStatus"='REMOVED' WHERE id=$1`, [id]);
      await check(db);
    });
  });

});
