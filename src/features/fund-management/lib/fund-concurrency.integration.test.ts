import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { disposable, migration } from "./fund-migration-test-support";
import { activate, pay } from "./fund-schema-test-support";

// Dedicated DBs permit actual COMMIT without deleting immutable financial rows.
const enabled = process.env.TEST_DATABASE_URL && process.env.VFC_ALLOW_MIGRATION_TESTS === "1";
async function seed(db: Client, id: string) {
  await db.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ($1,$1,'Test',now())`, [id]);
  await db.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ($1,$1,'H1',now())`, [id]);
  await db.query(`INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt") VALUES ($1,$1,$1,'CHIEF','ACTIVE','Test','unused',now())`, [id]);
  await db.query(`UPDATE "House" SET "headOfHouseId"=$1 WHERE id=$1`, [id]);
  await db.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") VALUES ($1,$1,'Test',1001,CURRENT_DATE-2,CURRENT_DATE+2,now())`, [id]);
}
async function close(db: Client, id: string) {
  await db.query(`UPDATE "Fund" SET status='CLOSED',"closedAt"=now(),"closedByUserId"=$1,"termsVersion"=3 WHERE id=$1`, [id]);
}
async function voidPayment(db: Client, id: string) {
  await db.query(`UPDATE "Payment" SET status='VOIDED',"voidReason"='Correction' WHERE id=$1`, [id]);
  await db.query(`UPDATE "Receipt" SET status='VOIDED' WHERE id=$1`, [id]);
}

describe.skipIf(!enabled)("scoped financial concurrency (real commits, no timing sleeps)", () => {
  it.each(["activation", "duplicate", "payment-close", "close-payment", "void-close", "close-void"])("coordinates %s conflicts", async (scenario) => {
    await disposable(async (db, url) => {
      await db.query(await migration()); await seed(db, "one");
      await db.query("BEGIN");
      if (scenario !== "activation") await activate(db, "one");
      if (scenario === "void-close" || scenario === "close-void") await pay(db, "one");
      await db.query("COMMIT");
      const other = new Client({ connectionString: url }); await other.connect();
      try {
        await db.query("BEGIN"); await other.query("BEGIN");
        // Awaited first acquisition is the barrier: contender never depends on a sleep.
        await db.query(`SELECT vfc_acquire_villages(ARRAY['one'])`);
        const operation = async (client: Client) => {
          if (scenario === "activation") await activate(client, "one");
          else if (scenario === "duplicate" || scenario === "payment-close") await pay(client, "one");
          else if (scenario === "void-close") await voidPayment(client, "one");
          else await close(client, "one");
        };
        await operation(db);
        const contender = (async () => { await other.query(`SELECT vfc_acquire_villages(ARRAY['one'])`); return scenario === "activation" ? activate(other, "one")
          : scenario === "duplicate" ? pay(other, "one", 1001, "-duplicate")
          : scenario === "close-payment" ? pay(other, "one")
          : scenario === "close-void" ? voidPayment(other, "one") : close(other, "one"); })();
        await expect(contender).rejects.toMatchObject({ code: "40001", message: "VFC_SCOPE_BUSY_RETRY_TRANSACTION" });
        await other.query("ROLLBACK");
        if (scenario === "close-payment") await expect(db.query("COMMIT")).rejects.toMatchObject({ message: "VFC_SNAPSHOT_OR_CLOSURE_INVALID" });
        else await db.query("COMMIT");
        await other.query("BEGIN");
        if (scenario === "close-payment") { await pay(other, "one"); await other.query("COMMIT"); }
        else if (scenario === "payment-close") { await close(other, "one"); await other.query("COMMIT"); }
        else if (scenario === "void-close") {
          await close(other, "one");
          await expect(other.query("COMMIT")).rejects.toMatchObject({ message: "VFC_SNAPSHOT_OR_CLOSURE_INVALID" });
        } else if (scenario === "duplicate") {
          await expect(pay(other, "one", 1001, "-duplicate")).rejects.toMatchObject({ code: "23505", constraint: "Payment_one_accepted_per_house" });
        } else if (scenario === "close-void") {
          await expect(voidPayment(other, "one")).rejects.toMatchObject({ message: "Closed fund is immutable" });
        } else {
          await expect(activate(other, "one")).rejects.toMatchObject({ message: "Assessment snapshot is immutable" });
        }
      } finally { await other.query("ROLLBACK"); await other.end(); await db.query("ROLLBACK"); }
    });
  }, 60000);
  it("does not block another village, password updates or unrelated audit inserts", async () => {
    await disposable(async (db, url) => {
      await db.query(await migration()); await seed(db, "one"); await seed(db, "two");
      const other = new Client({ connectionString: url }); await other.connect();
      try {
        await db.query("BEGIN"); await db.query(`SELECT vfc_acquire_villages(ARRAY['one'])`);
        await other.query("BEGIN"); await other.query(`SET LOCAL lock_timeout='500ms'`);
        await activate(other, "two");
        await other.query(`UPDATE "User" SET "passwordHash"='updated' WHERE id='one'`);
        await other.query(`INSERT INTO "AuditLog"(id,"entityType","actionType") VALUES ('audit','SESSION','LOGIN')`);
        await other.query("COMMIT");
      } finally { await other.query("ROLLBACK"); await other.end(); await db.query("ROLLBACK"); }
    });
  }, 60000);
  it("aborts a legacy House-first writer without waiting on the village scope", async () => {
    await disposable(async (db, url) => {
      await db.query(await migration()); await seed(db, "one");
      const legacy = new Client({ connectionString: url }); await legacy.connect();
      try {
        await legacy.query("BEGIN");
        await legacy.query(`SELECT id FROM "House" WHERE id='one' FOR NO KEY UPDATE`);
        await db.query("BEGIN"); await db.query(`SELECT vfc_acquire_villages(ARRAY['one'])`);
        await expect(legacy.query(`UPDATE "House" SET "houseNumber"='renumbered' WHERE id='one'`))
          .rejects.toMatchObject({ code: "40001", message: "VFC_SCOPE_BUSY_RETRY_TRANSACTION" });
      } finally { await legacy.query("ROLLBACK"); await legacy.end(); await db.query("ROLLBACK"); }
    });
  }, 60000);
  it("allows only one of two competing Fund activations in one Village", async () => {
    await disposable(async (db, url) => {
      await db.query(await migration()); await seed(db, "one");
      await db.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") SELECT 'second',"villageId",name,"villageTargetAmount","startDate","endDate",now() FROM "Fund" WHERE id='one'`);
      const other = new Client({ connectionString: url }); await other.connect();
      const activateSecond = async () => {
        await other.query(`SELECT vfc_acquire_villages(ARRAY['one'])`);
        await other.query(`INSERT INTO "FundHouseAssessment"(id,"fundId","houseId","villageId","assessmentAmount","houseNumberSnapshot") VALUES ('second','second','one','one',1001,'H1')`);
        await other.query(`UPDATE "Fund" SET status='ACTIVE',"eligibleHouseCount"=1,"assessmentPerHouse"=1001,"snapshotAt"=now(),"termsVersion"=2 WHERE id='second'`);
      };
      try {
        await db.query("BEGIN"); await activate(db, "one");
        await other.query("BEGIN");
        await expect(activateSecond()).rejects.toMatchObject({ code: "40001", message: "VFC_SCOPE_BUSY_RETRY_TRANSACTION" });
        await other.query("ROLLBACK"); await db.query("COMMIT");
        await other.query("BEGIN");
        await expect(activateSecond()).rejects.toMatchObject({ code: "23505", constraint: "Fund_one_active_per_village" });
      } finally { await other.query("ROLLBACK"); await other.end(); await db.query("ROLLBACK"); }
    });
  }, 60000);

  it("rejects a payment after a competing successful closure", async () => {
    await disposable(async (db, url) => {
      await db.query(await migration()); await seed(db, "one");
      await db.query('BEGIN'); await activate(db, 'one'); await pay(db, 'one'); await db.query('COMMIT');
      const other = new Client({connectionString:url}); await other.connect();
      try {
        await db.query('BEGIN'); await db.query(`SELECT vfc_acquire_villages(ARRAY['one'])`); await close(db,'one');
        await other.query('BEGIN');
        await expect(other.query(`SELECT vfc_acquire_villages(ARRAY['one'])`)).rejects.toMatchObject({code:'40001',message:'VFC_SCOPE_BUSY_RETRY_TRANSACTION'});
        await other.query('ROLLBACK');
        await db.query('COMMIT'); // Explicit closure-commit barrier before retry.
        await other.query('BEGIN'); await other.query(`SELECT vfc_acquire_villages(ARRAY['one'])`);
        await expect(pay(other,'one',1001,'-after-close')).rejects.toMatchObject({code:'P0001',message:'Closed fund is immutable'});
      } finally { await other.query('ROLLBACK'); await other.end(); await db.query('ROLLBACK'); }
    });
  },60000);
  it("commits financial operations in two villages while the first remains open", async () => {
    await disposable(async (db,url) => {
      await db.query(await migration()); await seed(db,'one'); await seed(db,'two');
      const other=new Client({connectionString:url}); await other.connect();
      try {
        await db.query('BEGIN'); await activate(db,'one'); await pay(db,'one');
        // First financial operation completed, but its transaction is still open.
        await other.query('BEGIN'); await other.query(`SET LOCAL lock_timeout='1s'`);
        await activate(other,'two'); await pay(other,'two'); await other.query('COMMIT');
        expect((await other.query(`SELECT count(*)::int AS count FROM "Payment" WHERE "fundId"='two'`)).rows[0].count).toBe(1);
        await db.query('COMMIT');
      } finally { await other.query('ROLLBACK'); await other.end(); await db.query('ROLLBACK'); }
    });
  },60000);
  it("acquires reversed multi-village inputs in the same sorted order", async () => {
    await disposable(async (db,url) => {
      await db.query(await migration()); await seed(db,'one'); await seed(db,'two');
      const other=new Client({connectionString:url}); await other.connect();
      try {
        await db.query('BEGIN');
        await db.query(`SELECT vfc_acquire_villages(ARRAY['two','one','two',NULL])`);
        const revisions=await db.query(`SELECT "villageId",revision::text AS revision FROM "VillageFinancialWriteLock" ORDER BY "villageId"`);
        await other.query('BEGIN');
        await expect(other.query(`SELECT vfc_acquire_villages(ARRAY['one','two'])`)).rejects.toMatchObject({code:'40001',message:'VFC_SCOPE_BUSY_RETRY_TRANSACTION'});
        await other.query('ROLLBACK'); await db.query('COMMIT');
        await other.query('BEGIN'); await other.query(`SELECT vfc_acquire_villages(ARRAY['one','two'])`); await other.query('COMMIT');
        const after=await db.query(`SELECT "villageId",revision::text AS revision FROM "VillageFinancialWriteLock" ORDER BY "villageId"`);
        expect(after.rows.map((r: {revision:string})=>BigInt(r.revision))).toEqual(revisions.rows.map((r: {revision:string})=>BigInt(r.revision)+BigInt(1)));
      } finally { await other.query('ROLLBACK'); await other.end(); await db.query('ROLLBACK'); }
    });
  },60000);

});
