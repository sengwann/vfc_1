import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { activate, check, fixture, pay } from "./fund-schema-test-support";

// Separate explicit opt-in: the disposable test server must permit CREATE ROLE.
// The random NOLOGIN role is test-only, never a guessed production identity.
const enabled = process.env.TEST_DATABASE_URL && process.env.VFC_ALLOW_ROLE_TESTS === "1";
describe.skipIf(!enabled)("restricted financial runtime role", () => {
  it("enforces deployment assertions and protects internal state while allowing financial writes", async () => {
    await fixture(async (db, id) => {
      const role = `vfc_test_runtime_${randomUUID().replaceAll("-", "")}`;
      const owner = (await db.query(`SELECT quote_ident(current_user) AS name`)).rows[0].name;
      // All role DDL, grants and test data roll back in fixture's finally block.
      await db.query(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
      await db.query(`GRANT "${role}" TO ${owner}`);
      await db.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC`);
      await db.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
      await db.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON "Village","User","House","Fund","Payment","Receipt","AuditLog","FundHouseAssessment","FundEndDateExtension","CollectorAssignment","VillageDeactivationRequest" TO "${role}"`);
      await db.query(`GRANT EXECUTE ON FUNCTION vfc_acquire_villages(text[]) TO "${role}"`);
      await db.query(`SELECT set_config('vfc.runtime_role',$1,true)`, [role]);
      const script = await readFile(path.join(process.cwd(), "scripts/fund-financial-privilege-assertions.sql"), "utf8");
      // Reuse the exact deployed assertion body; fixture owns transaction handling.
      const assertion = script.slice(script.indexOf("DO $$"), script.lastIndexOf("ROLLBACK;"));
      await db.query(assertion);
      await db.query('SAVEPOINT unsafe_grant');
      await db.query(`GRANT DELETE ON "FundFinancialValidationWork" TO "${role}"`);
      await expect(db.query(assertion)).rejects.toMatchObject({code:'P0001',message:expect.stringContaining('VFC_PRIV_INTERNAL_TABLE_ACCESS')});
      await db.query('ROLLBACK TO SAVEPOINT unsafe_grant');
      await db.query(`SET LOCAL ROLE "${role}"`);
      const denied = async (sql: string) => {
        await db.query('SAVEPOINT denied');
        await expect(db.query(sql)).rejects.toMatchObject({code:'42501'});
        await db.query('ROLLBACK TO SAVEPOINT denied');
      };
      for (const table of ['FundFinancialValidationWork','VillageFinancialWriteLock']) {
        const values = table === 'FundFinancialValidationWork'
          ? `("transactionId","scopeType","scopeId") VALUES (txid_current(),'FUND','forbidden')`
          : `("villageId") VALUES ('forbidden')`;
        await denied(`INSERT INTO "${table}" ${values}`);
        await denied(`UPDATE "${table}" SET ${table === 'FundFinancialValidationWork' ? '"scopeId"="scopeId"' : 'revision=revision'}`);
        await denied(`DELETE FROM "${table}"`);
        await denied(`SELECT * FROM "${table}"`);
        await denied(`TRUNCATE "${table}"`);
      }
      for (const helper of ['vfc_scope_change','vfc_validate_work','vfc_bootstrap_village_scope']) {
        await denied(`SELECT ${helper}()`);
      }
      await denied(`CREATE TABLE public.vfc_runtime_forbidden(id integer)`);
      await denied(`ALTER TABLE "Payment" DISABLE TRIGGER ALL`);
      await denied(`SET LOCAL session_replication_role='replica'`);
      await db.query(`SELECT vfc_acquire_villages(ARRAY[$1])`, [id]);
      await activate(db,id); await pay(db,id); await check(db);
      expect((await db.query(`SELECT status FROM "Payment" WHERE id=$1`,[id])).rows[0].status).toBe('ACCEPTED');
      expect((await db.query(`SELECT status FROM "Receipt" WHERE id=$1`,[id])).rows[0].status).toBe('ACTIVE');
      const emptyVillage = id + '-runtime-empty';
      await db.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ($1,$1,'Runtime empty',now())`, [emptyVillage]);
      await db.query(`DELETE FROM "Village" WHERE id=$1`, [emptyVillage]);
      await check(db);
      await db.query('RESET ROLE');
      expect((await db.query(`SELECT count(*)::int AS count FROM "VillageFinancialWriteLock" WHERE "villageId"=$1`, [emptyVillage])).rows[0].count).toBe(0);
      expect((await db.query(`SELECT count(*)::int AS count FROM "FundFinancialValidationWork" WHERE "transactionId"=txid_current()`)).rows[0].count).toBe(0);
    });
  });
});
