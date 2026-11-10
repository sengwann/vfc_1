import { describe, expect, it } from "vitest";
import { activate, check, fixture, pay } from "./fund-schema-test-support";

// These are NOT executed without the separately authorized disposable DB.
describe.skipIf(!process.env.TEST_DATABASE_URL)("Fund financial database invariants", () => {
  it("accepts a complete snapshot, exact payment and matching receipt", async () => {
    await fixture(async (db, id) => { await activate(db, id); await pay(db, id); await check(db); });
  });
  it.each([0, -1, 1000000001])("rejects village target %s", async (amount) => {
    await fixture(async (db, id) => {
      await expect(db.query('UPDATE "Fund" SET "villageTargetAmount"=$2,"termsVersion"=2 WHERE id=$1', [id, amount])).rejects.toMatchObject({ code: "23514", constraint: "Fund_target_check" });
    });
  });
  it("rejects zero-house activation", async () => {
    await fixture(async (db, id) => {
      await expect(db.query(`UPDATE "Fund" SET status='ACTIVE',"eligibleHouseCount"=0,"assessmentPerHouse"=1001,"snapshotAt"=now(),"termsVersion"=2 WHERE id=$1`, [id])).rejects.toMatchObject({ code: "23514", constraint: "Fund_snapshot_check" });
    });
  });
  it("rejects an incomplete snapshot at transaction end", async () => {
    await fixture(async (db, id) => {
      await db.query(`UPDATE "Fund" SET status='ACTIVE',"eligibleHouseCount"=1,"assessmentPerHouse"=1001,"snapshotAt"=now(),"termsVersion"=2 WHERE id=$1`, [id]);
      await expect(check(db)).rejects.toMatchObject({ message: "VFC_SNAPSHOT_OR_CLOSURE_INVALID" });
    });
  });
  it("rejects a second active fund in the same village", async () => {
    await fixture(async (db, id) => {
      await activate(db, id);
      const second = id + "-second";
      await db.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt")
        SELECT $2,"villageId",name,"villageTargetAmount","startDate","endDate",now() FROM "Fund" WHERE id=$1`, [id, second]);
      await expect(db.query(`UPDATE "Fund" SET status='ACTIVE',"eligibleHouseCount"=1,"assessmentPerHouse"=1001,"snapshotAt"=now(),"termsVersion"=2 WHERE id=$1`, [second])).rejects.toMatchObject({ code: "23505", constraint: "Fund_one_active_per_village" });
    });
  });
  it.each([1000, 0, -1, 10000001])("rejects payment %s", async (amount) => {
    await fixture(async (db, id) => { await activate(db, id); await expect(pay(db, id, amount)).rejects.toMatchObject((amount <= 1000 ? { message: "Payment below assessment" } : { code: "23514", constraint: "Payment_amount_check" })); });
  });
  it.each([1001, 1500, 10000000])("accepts payment %s", async (amount) => {
    await fixture(async (db, id) => { await activate(db, id); await pay(db, id, amount); await check(db); });
  });
  it("requires receipt atomicity", async () => {
    await fixture(async (db, id) => {
      await activate(db, id);
      await db.query(`INSERT INTO "Payment"(id,"villageId","fundId","houseId","fundHouseAssessmentId","payerUserId",amount,"updatedAt") VALUES ($1,$1,$1,$1,$1,$1,1001,now())`, [id]);
      await expect(check(db)).rejects.toMatchObject({ message: "VFC_PAYMENT_RECEIPT_INCONSISTENT" });
    });
  });
  it("rejects duplicate accepted payment but allows void and replacement", async () => {
    await fixture(async (db, id) => {
      await activate(db, id); await pay(db, id); await check(db);
      await db.query('SAVEPOINT duplicate');
      await expect(pay(db, id, 1001, "-duplicate")).rejects.toMatchObject({ code: "23505", constraint: "Payment_one_accepted_per_house" });
      await db.query('ROLLBACK TO SAVEPOINT duplicate');
      await db.query(`UPDATE "Payment" SET status='VOIDED',"voidReason"='Correction' WHERE id=$1`, [id]);
      await db.query(`UPDATE "Receipt" SET status='VOIDED' WHERE id=$1`, [id]);
      await pay(db, id, 1500, "-replacement"); await check(db);
    });
  });
  it("rejects mismatched assessment and payment identity", async () => {
    await fixture(async (db, id) => {
      await activate(db, id);
      await expect(db.query(`INSERT INTO "Payment"(id,"villageId","fundId","houseId","fundHouseAssessmentId","payerUserId",amount,"updatedAt")
        VALUES ($1,$1,$1,$1,'missing',$1,1001,now())`, [id])).rejects.toMatchObject({ code: "23503", constraint: "Payment_assessment_fkey" });
    });
  });
  it("freezes house display independently of later house numbering", async () => {
    await fixture(async (db, id) => {
      await activate(db, id); await check(db);
      await db.query('UPDATE "House" SET "houseNumber"=\'H2\' WHERE id=$1', [id]);
      await check(db);
      const result = await db.query('SELECT "houseNumberSnapshot" FROM "FundHouseAssessment" WHERE id=$1', [id]);
      expect(result.rows[0].houseNumberSnapshot).toBe("H1");
    });
  });
  it.each([10000000, 10000001])("enforces assessment boundary %s", async (amount) => {
    await fixture(async (db, id) => {
      await db.query('UPDATE "Fund" SET "villageTargetAmount"=$2,"termsVersion"=2 WHERE id=$1', [id, amount]);
      // This draft edit consumes a version; activation must consume the next one.
      await db.query(`INSERT INTO "FundHouseAssessment"(id,"fundId","houseId","villageId","assessmentAmount","houseNumberSnapshot")
        VALUES ($1,$1,$1,$1,$2,'H1')`, [id, Math.min(amount, 10000000)]);
      const operation = () => db.query(`UPDATE "Fund" SET status='ACTIVE',"eligibleHouseCount"=1,"assessmentPerHouse"=$2,"snapshotAt"=now(),"termsVersion"=3 WHERE id=$1`, [id, amount]);
      if (amount > 10000000) await expect(operation()).rejects.toMatchObject({ code: "23514", constraint: "Fund_snapshot_check" });
      else { await operation(); await check(db); }
    });
  });
  it("freezes 100 houses at ceil(100001/100)=1001 with total 100100 and surplus 99", async () => {
    await fixture(async (db, id) => {
      await db.query(`UPDATE "Fund" SET "villageTargetAmount"=100001,"termsVersion"=2 WHERE id=$1`, [id]);
      await db.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt")
        SELECT $1||'-'||n,$1,'H'||(n+1),now() FROM generate_series(1,99) n`, [id]);
      await db.query(`INSERT INTO "User"(id,"villageId","houseId","membershipStatus",name,"passwordHash","updatedAt")
        SELECT $1||'-'||n,$1,$1||'-'||n,'ACTIVE','Test','unused',now() FROM generate_series(1,99) n`, [id]);
      await db.query(`UPDATE "House" SET "headOfHouseId"=id WHERE "villageId"=$1`, [id]);
      await db.query(`INSERT INTO "FundHouseAssessment"(id,"fundId","houseId","villageId","assessmentAmount","houseNumberSnapshot")
        SELECT id,$1,id,$1,1001,"houseNumber" FROM "House" WHERE "villageId"=$1`, [id]);
      await db.query(`UPDATE "Fund" SET status='ACTIVE',"eligibleHouseCount"=100,"assessmentPerHouse"=1001,"snapshotAt"=now(),"termsVersion"=3 WHERE id=$1`, [id]);
      await check(db);
      const result = await db.query(`SELECT sum("assessmentAmount")::text AS total, (sum("assessmentAmount")-100001)::text AS surplus FROM "FundHouseAssessment" WHERE "fundId"=$1`, [id]);
      expect(result.rows[0]).toEqual({ total: "100100", surplus: "99" });
    });
  });
  it.each(["INSERT", "UPDATE", "DELETE"])("protects activated snapshot against %s", async (operation) => {
    await fixture(async (db, id) => {
      await activate(db, id); await check(db);
      const sql = operation === "INSERT" ? `INSERT INTO "FundHouseAssessment"(id,"fundId","houseId","villageId","assessmentAmount","houseNumberSnapshot") VALUES ($1||'-new',$1,$1,$1,1001,'H1')`
        : operation === "UPDATE" ? `UPDATE "FundHouseAssessment" SET "assessmentAmount"=1002 WHERE id=$1`
        : `DELETE FROM "FundHouseAssessment" WHERE id=$1`;
      await expect(db.query(sql, [id])).rejects.toMatchObject({ message: operation === "DELETE" ? "Financial history cannot be deleted" : "Assessment snapshot is immutable" });
    });
  });
  it.each(["fund", "house", "village"])("rejects an existing cross-%s assessment", async (dimension) => {
    await fixture(async (db, id) => {
      const other = id + '-other';
      if (dimension === "house") {
        await db.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ($2,$1,'Other',now())`, [id, other]);
        await db.query(`INSERT INTO "User"(id,"villageId","houseId","membershipStatus",name,"passwordHash","updatedAt") VALUES ($2,$1,$2,'ACTIVE','Other','unused',now())`, [id, other]);
        await db.query(`UPDATE "House" SET "headOfHouseId"=$1 WHERE id=$1`, [other]);
        await db.query(`INSERT INTO "FundHouseAssessment"(id,"fundId","houseId","villageId","assessmentAmount","houseNumberSnapshot") VALUES ($1,$1,$1,$1,501,'H1'),($2,$1,$2,$1,501,'Other')`, [id, other]);
        await db.query(`UPDATE "Fund" SET status='ACTIVE',"eligibleHouseCount"=2,"assessmentPerHouse"=501,"snapshotAt"=now(),"termsVersion"=2 WHERE id=$1`, [id]);
      } else {
        await activate(db, id); await check(db);
        if (dimension === "village") {
          await db.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ($1,$1,'Other',now())`, [other]);
          await db.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ($1,$1,'Other',now())`, [other]);
          await db.query(`INSERT INTO "User"(id,"villageId","houseId","membershipStatus",name,"passwordHash","updatedAt") VALUES ($1,$1,$1,'ACTIVE','Other','unused',now())`, [other]);
          await db.query(`UPDATE "House" SET "headOfHouseId"=$1 WHERE id=$1`, [other]);
        }
        await db.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") VALUES ($1,$2,'Other',1001,CURRENT_DATE-2,CURRENT_DATE+2,now())`, [other, dimension === "village" ? other : id]);
        await db.query(`INSERT INTO "FundHouseAssessment"(id,"fundId","houseId","villageId","assessmentAmount","houseNumberSnapshot") VALUES ($1,$1,$2,$2,1001,$3)`, [other, dimension === "village" ? other : id, dimension === "village" ? "Other" : "H1"]);
        if (dimension === "village") {
          await db.query(`UPDATE "Fund" SET status='ACTIVE',"eligibleHouseCount"=1,"assessmentPerHouse"=1001,"snapshotAt"=now(),"termsVersion"=2 WHERE id=$1`, [other]);
        } else {
          // A different Fund owns this existing assessment. The composite FK is immediate.
        }
      }
      await expect(db.query(`INSERT INTO "Payment"(id,"villageId","fundId","houseId","fundHouseAssessmentId","payerUserId",amount,"updatedAt") VALUES ($1||'-bad',$1,$1,$1,$2,$1,1001,now())`, [id, other]))
        .rejects.toMatchObject({ code: "23503", constraint: "Payment_assessment_fkey" });
    });
  });
  it("excludes a house created after activation", async () => {
    await fixture(async (db, id) => {
      await activate(db, id); await check(db);
      await db.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ($1||'-later',$1,'Later',now())`, [id]);
      await db.query(`INSERT INTO "User"(id,"villageId","houseId","membershipStatus",name,"passwordHash","updatedAt") VALUES ($1||'-later-member',$1,$1||'-later','ACTIVE','Later','unused',now())`, [id]);
      await db.query(`UPDATE "House" SET "headOfHouseId"=$1||'-later-member' WHERE id=$1||'-later'`, [id]);
      await check(db);
      const result = await db.query(`SELECT count(*)::int AS count FROM "FundHouseAssessment" WHERE "fundId"=$1`, [id]);
      expect(result.rows[0].count).toBe(1);
    });
  });
  it("rejects omission of an otherwise eligible house", async () => {
    await fixture(async (db, id) => {
      await db.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ($1||'-omitted',$1,'Omitted',now())`, [id]);
      await db.query(`INSERT INTO "User"(id,"villageId","houseId","membershipStatus",name,"passwordHash","updatedAt") VALUES ($1||'-member',$1,$1||'-omitted','ACTIVE','Other','unused',now())`, [id]);
      await activate(db, id);
      await expect(check(db)).rejects.toMatchObject({ message: "Activation snapshot does not match eligible houses" });
    });
  });
  it.each(["paymentId", "receiptNumber", "villageId"])("rejects receipt %s reassignment", async (column) => {
    await fixture(async (db, id) => {
      await activate(db, id); await pay(db, id); await check(db);
      await expect(db.query(`UPDATE "Receipt" SET "${column}"=$2 WHERE id=$1`, [id, id + '-other']))
        .rejects.toMatchObject({ code: "P0001", message: "Receipt identity is immutable" });
    });
  });
  it("deduplicates work and handles early flush and savepoint rollback", async () => {
    await fixture(async (db, id) => {
      await activate(db, id);
      const queued = await db.query(`SELECT count(*)::int AS count FROM "FundFinancialValidationWork" WHERE "transactionId"=txid_current()`);
      expect(queued.rows[0].count).toBe(2);
      await check(db);
      await db.query("SAVEPOINT candidate");
      await db.query(`UPDATE "House" SET "headOfHouseId"=NULL WHERE id=$1`, [id]);
      await db.query("ROLLBACK TO SAVEPOINT candidate");
      await pay(db, id); await check(db);
      const empty = await db.query(`SELECT count(*)::int AS count FROM "FundFinancialValidationWork" WHERE "transactionId"=txid_current()`);
      expect(empty.rows[0].count).toBe(0);
    });
  });
  it.each(["UTC", "America/New_York", "Asia/Yangon"])("uses Yangon boundaries with session zone %s", async (zone) => {
    await fixture(async (db) => {
      await db.query("SELECT set_config('TimeZone',$1,true)", [zone]);
      const result = await db.query(`SELECT
        vfc_payment_window('2026-12-01','2026-12-31','2026-12-31 17:29:59.999999+00') AS last_instant,
        vfc_payment_window('2026-12-01','2026-12-31','2026-12-31 17:30:00+00') AS midnight,
        vfc_fund_expired('2026-12-31','2026-12-31 17:29:59.999999+00') AS before_expiry,
        vfc_fund_expired('2026-12-31','2026-12-31 17:30:00+00') AS after_expiry`);
      expect(result.rows[0]).toEqual({ last_instant: true, midnight: false, before_expiry: false, after_expiry: true });
    });
  });
  it("bootstraps every new Village scope and fails safely if it is missing", async () => {
    await fixture(async (db, id) => {
      const scope = await db.query(`SELECT count(*)::int AS count FROM "VillageFinancialWriteLock" WHERE "villageId"=$1`, [id]);
      expect(scope.rows[0].count).toBe(1);
      // Test owner deliberately simulates corruption; runtime has no DELETE grant.
      await db.query(`DELETE FROM "VillageFinancialWriteLock" WHERE "villageId"=$1`, [id]);
      await expect(db.query(`UPDATE "House" SET "isActive"=false WHERE id=$1`, [id]))
        .rejects.toMatchObject({ code: "P0001", message: "VFC_SCOPE_MISSING" });
    });
  });

  it("deletes an empty Village together with its internal scope", async () => {
    await fixture(async (db, id) => {
      const empty = id + '-empty';
      await db.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ($1,$1,'Empty',now())`, [empty]);
      expect((await db.query(`SELECT count(*)::int AS count FROM "VillageFinancialWriteLock" WHERE "villageId"=$1`, [empty])).rows[0].count).toBe(1);
      await db.query(`DELETE FROM "Village" WHERE id=$1`, [empty]);
      await check(db);
      expect((await db.query(`SELECT count(*)::int AS count FROM "VillageFinancialWriteLock" WHERE "villageId"=$1`, [empty])).rows[0].count).toBe(0);
    });
  });
  it("retains restrictive financial Village references", async () => {
    await fixture(async (db, id) => {
      const village = id + '-fund-only';
      await db.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ($1,$1,'Financial',now())`, [village]);
      await db.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") VALUES ($1,$1,'Draft',1001,CURRENT_DATE,CURRENT_DATE,now())`, [village]);
      await expect(db.query(`DELETE FROM "Village" WHERE id=$1`, [village])).rejects.toMatchObject({code:'23503', constraint:'Fund_villageId_fkey'});
    });
  });
  it("rejects invalid work re-enqueued after an early flush", async () => {
    await fixture(async (db, id) => {
      await activate(db, id); await check(db);
      await db.query(`UPDATE "House" SET "headOfHouseId"=NULL WHERE id=$1`, [id]);
      await expect(check(db)).rejects.toMatchObject({code:'P0001', message:'VFC_ACTIVE_HOUSE_HEAD_PROTECTED'});
    });
  });
  it("restores consumed pre-savepoint work and validates it again", async () => {
    await fixture(async (db, id) => {
      await activate(db, id); await check(db);
      await db.query(`UPDATE "House" SET "headOfHouseId"=NULL WHERE id=$1`, [id]);
      await db.query('SAVEPOINT repair');
      await db.query(`UPDATE "House" SET "headOfHouseId"=$1 WHERE id=$1`, [id]);
      await check(db);
      expect((await db.query(`SELECT count(*)::int AS count FROM "FundFinancialValidationWork" WHERE "transactionId"=txid_current()`)).rows[0].count).toBe(0);
      await db.query('ROLLBACK TO SAVEPOINT repair');
      expect((await db.query(`SELECT count(*)::int AS count FROM "FundFinancialValidationWork" WHERE "transactionId"=txid_current()`)).rows[0].count).toBe(1);
      await expect(check(db)).rejects.toMatchObject({code:'P0001', message:'VFC_ACTIVE_HOUSE_HEAD_PROTECTED'});
    });
  });
  it("queues both OLD and NEW villages on member movement", async () => {
    await fixture(async (db, id) => {
      const other = id + '-destination'; const member = id + '-moving';
      await db.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ($1,$1,'Destination',now())`, [other]);
      await db.query(`INSERT INTO "User"(id,"villageId","houseId","membershipStatus",name,"passwordHash","updatedAt") VALUES ($2,$1,$1,'ACTIVE','Moving','unused',now())`, [id, member]);
      await check(db);
      await db.query(`UPDATE "User" SET "villageId"=$2,"houseId"=NULL WHERE id=$1`, [member, other]);
      const rows = await db.query(`SELECT "scopeId" FROM "FundFinancialValidationWork" WHERE "transactionId"=txid_current() AND "scopeType"='VILLAGE' ORDER BY "scopeId"`);
      expect(rows.rows.map((r: {scopeId:string})=>r.scopeId)).toEqual([id, other].sort());
      await check(db);
    });
  });
  it("rejects a Receipt linked to an existing Payment in another Village", async () => {
    await fixture(async (db, id) => {
      await activate(db, id);
      const other = id + '-receipt-village';
      await db.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ($1,$1,'Other',now())`, [other]);
      await db.query(`INSERT INTO "Payment"(id,"villageId","fundId","houseId","fundHouseAssessmentId","payerUserId",amount,"updatedAt") VALUES ($1,$1,$1,$1,$1,$1,1001,now())`, [id]);
      await expect(db.query(`INSERT INTO "Receipt"(id,"receiptNumber","paymentId","villageId","updatedAt") VALUES ($1,$1,$1,$2,now())`, [id, other]))
        .rejects.toMatchObject({code:'23503', constraint:'Receipt_paymentId_villageId_fkey'});
    });
  });

});
