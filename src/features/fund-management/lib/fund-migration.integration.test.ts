import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { disposable, migration } from "./fund-migration-test-support";

describe.skipIf(
  !process.env.TEST_DATABASE_URL ||
    process.env.VFC_ALLOW_MIGRATION_TESTS !== "1",
)("Fund migration on separately authorized disposable databases", () => {
  it("applies after the complete old chain and preserves unrelated records", async () => {
    await disposable(async (db) => {
      await db.query(
        `INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ('retained','retained','Retained',now())`,
      );
      await db.query(await migration());
      const row = await db.query(
        `SELECT name FROM "Village" WHERE id='retained'`,
      );
      expect(row.rows[0].name).toBe("Retained");
      const locks = await db.query(
        'SELECT count(*)::int AS count FROM "VillageFinancialWriteLock"',
      );
      expect(locks.rows[0].count).toBe(1);
      const indexes = await db.query(
        `SELECT indexname FROM pg_indexes WHERE indexname IN ('Fund_one_active_per_village','Payment_one_accepted_per_house')`,
      );
      expect(indexes.rowCount).toBe(2);
    });
  }, 60000);
  it.each(["fund", "audit"])(
    "refuses unexpected %s history and rolls back DDL",
    async (kind) => {
      await disposable(async (db) => {
        await db.query(
          `INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ('history','history','History',now())`,
        );
        if (kind === "fund") {
          await db.query(
            `INSERT INTO "Fund"(id,"villageId",name,"targetAmount","startDate","endDate","updatedAt") VALUES ('history','history','History',1000,CURRENT_DATE,CURRENT_DATE,now())`,
          );
        } else {
          await db.query(
            `INSERT INTO "AuditLog"(id,"entityType","actionType",metadata) VALUES ('history','OTHER','CREATE','{"fundId":"deleted-fund"}')`,
          );
        }
        await expect(db.query(await migration())).rejects.toMatchObject({
          code: "P0001",
          message: expect.stringContaining("Financial history exists"),
        });
        await db.query("ROLLBACK");
        const columns = await db.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='Fund' AND column_name='targetAmount'`,
        );
        expect(columns.rowCount).toBe(1);
        const table = await db.query(
          `SELECT to_regclass('public."FundHouseAssessment"') AS name`,
        );
        expect(table.rows[0].name).toBeNull();
        const history = await db.query(
          `SELECT count(*)::int AS count FROM "${kind === "fund" ? "Fund" : "AuditLog"}"`,
        );
        expect(history.rows[0].count).toBe(1);
      });
    },
    60000,
  );
  it.each(["REPEATABLE READ", "SERIALIZABLE"])(
    "rejects a stale %s scope acquisition",
    async (isolation) => {
      await disposable(async (db, url) => {
        await db.query(await migration());
        await db.query(
          `INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ('stale','stale','Stale',now())`,
        );
        const stale = new Client({ connectionString: url });
        await stale.connect();
        try {
          await stale.query(`BEGIN ISOLATION LEVEL ${isolation}`);
          await stale.query('SELECT revision FROM "VillageFinancialWriteLock"');
          await db.query("BEGIN");
          await db.query(`SELECT vfc_acquire_villages(ARRAY['stale'])`);
          await db.query("COMMIT");
          await expect(
            stale.query(`SELECT vfc_acquire_villages(ARRAY['stale'])`),
          ).rejects.toMatchObject({ code: "40001" });
        } finally {
          await stale.query("ROLLBACK");
          await stale.end();
        }
      });
    },
    60000,
  );
  it("rolls back all DDL after a test-only failure before COMMIT", async () => {
    await disposable(async (db) => {
      const sql = (await migration()).replace(
        /COMMIT;\s*$/,
        () =>
          "DO $$ BEGIN RAISE EXCEPTION 'VFC_TEST_INJECTED_FAILURE'; END; $$; COMMIT;",
      );
      await expect(db.query(sql)).rejects.toMatchObject({
        code: "P0001",
        message: "VFC_TEST_INJECTED_FAILURE",
      });
      await db.query("ROLLBACK");
      const columns = await db.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name='Fund' AND column_name='targetAmount'`,
      );
      expect(columns.rowCount).toBe(1);
      for (const table of [
        "FundHouseAssessment",
        "VillageFinancialWriteLock",
        "FundFinancialValidationWork",
      ]) {
        const result = await db.query("SELECT to_regclass($1) AS object", [
          `public."${table}"`,
        ]);
        expect(result.rows[0].object).toBeNull();
      }
      const functions = await db.query(
        `SELECT count(*)::int AS count FROM pg_proc WHERE proname LIKE 'vfc_%'`,
      );
      expect(functions.rows[0].count).toBe(0);
      const indexes = await db.query(
        `SELECT count(*)::int AS count FROM pg_indexes WHERE indexname IN ('Fund_one_active_per_village','Receipt_paymentId_villageId_key')`,
      );
      expect(indexes.rows[0].count).toBe(0);
    });
  }, 60000);
});
