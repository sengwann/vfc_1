/** Authored only: requires explicit disposable-database opt-in before execution. */
import { Pool, type Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { disposable, migration } from "@/features/fund-management/lib/fund-migration-test-support";
import { acquireVillageScopes } from "./village-scope";
import { lockFunds, lockHouses } from "./financial-locks";
import { inspectDatabaseError } from "./database-errors";
import { withSerializableRetry } from "./transaction";

const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.VFC_ALLOW_MIGRATION_TESTS === "1";

function barrier() {
  let open!: () => void;
  const reached = new Promise<void>((resolve) => { open = resolve; });
  return { reached, open };
}

async function fixture(run: (prisma: PrismaClient, raw: Client) => Promise<void>) {
  await disposable(async (raw, url) => {
    await raw.query(await migration());
    for (const id of ["a", "b"]) {
      await raw.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ($1,$1,'Scope test',now())`, [id]);
      await raw.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ($1,$1,'H1',now())`, [id]);
      await raw.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt")
        VALUES ($1,$1,'Draft',1001,CURRENT_DATE,CURRENT_DATE+1,now())`, [id]);
    }
    const pool = new Pool({ connectionString: url, max: 4 });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    try {
      const identity = await prisma.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
      expect(identity[0].name).toBe(new URL(url).pathname.slice(1));
      await run(prisma, raw);
    } finally { await prisma.$disconnect(); }
  });
}

describe.skipIf(!enabled)("Phase 3A transaction infrastructure (disposable PostgreSQL)", () => {
  it("acquires all sorted scopes once, then ordered tenant-filtered Fund/House locks", async () => {
    await fixture(async (prisma) => {
      await prisma.$transaction(async (tx) => {
        const before = await tx.$queryRaw<{ villageId: string; revision: bigint }[]>`
          SELECT "villageId",revision FROM "VillageFinancialWriteLock" ORDER BY "villageId"`;
        await acquireVillageScopes(tx, ["b", "a", "b"]);
        const after = await tx.$queryRaw<{ villageId: string; revision: bigint }[]>`
          SELECT "villageId",revision FROM "VillageFinancialWriteLock" ORDER BY "villageId"`;
        expect(after.map((row, i) => row.revision - before[i].revision)).toEqual([BigInt(1), BigInt(1)]);
        const targets = [{ id: "b", villageId: "b" }, { id: "a", villageId: "a" }];
        expect((await lockFunds(tx, targets)).map((row) => row.id)).toEqual(["a", "b"]);
        expect((await lockHouses(tx, targets)).map((row) => row.id)).toEqual(["a", "b"]);
      });
      await expect(prisma.$transaction(async (tx) => {
        await acquireVillageScopes(tx, ["a", "b"]);
        await lockFunds(tx, [{ id: "a", villageId: "b" }]);
      })).rejects.toMatchObject({ code: "VFC_LOCK_TARGET_NOT_FOUND" });
      await expect(prisma.$transaction(async (tx) => {
        await acquireVillageScopes(tx, ["a", "b"]);
        await lockHouses(tx, [{ id: "a", villageId: "b" }]);
      })).rejects.toMatchObject({ code: "VFC_LOCK_TARGET_NOT_FOUND" });
    });
  }, 60000);

  it("does not retry a missing scope through the real adapter", async () => {
    await fixture(async (prisma) => {
      let attempts = 0;
      const failure = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
        attempts += 1;
        await acquireVillageScopes(tx, ["missing"]);
      })).then(() => undefined, (error: unknown) => error);
      expect(inspectDatabaseError(failure)).toMatchObject({ sqlStates: ["P0001"], retryable: false });
      // Stable identifier from the trigger, not an arbitrary any-error assertion.
      expect(String(failure)).toContain("VFC_SCOPE_MISSING");
      expect(attempts).toBe(1);
    });
  }, 60000);

  it("rejects same-village contention but permits independent villages", async () => {
    await fixture(async (prisma) => {
      const acquired = barrier(); const release = barrier();
      const holder = prisma.$transaction(async (tx) => {
        await acquireVillageScopes(tx, ["a"]);
        acquired.open(); await release.reached;
      }, { timeout: 15000 });
      const observed = holder.then(() => undefined, (error: unknown) => { acquired.open(); return error; });
      try {
        await acquired.reached;
        const conflict = await prisma.$transaction((tx) => acquireVillageScopes(tx, ["a"]))
          .then(() => undefined, (error: unknown) => error);
        expect(inspectDatabaseError(conflict)).toMatchObject({ sqlStates: ["40001"], retryable: true });
        expect(String(conflict)).toContain("VFC_SCOPE_BUSY_RETRY_TRANSACTION");
        await prisma.$transaction(async (tx) => {
          await acquireVillageScopes(tx, ["b"]);
          await lockFunds(tx, [{ id: "b", villageId: "b" }]);
          await lockHouses(tx, [{ id: "b", villageId: "b" }]);
        });
      } finally { release.open(); expect(await observed).toBeUndefined(); }
    });
  }, 60000);

  it("holds Fund update locks and House non-key-update locks until transaction end", async () => {
    await fixture(async (prisma, raw) => {
      const acquired = barrier(); const release = barrier();
      const holder = prisma.$transaction(async (tx) => {
        await acquireVillageScopes(tx, ["a"]);
        await lockFunds(tx, [{ id: "a", villageId: "a" }]);
        await lockHouses(tx, [{ id: "a", villageId: "a" }]);
        acquired.open(); await release.reached;
      }, { timeout: 15000 }).then(() => undefined, (error: unknown) => { acquired.open(); return error; });
      try {
        await acquired.reached;
        await raw.query("BEGIN");
        // KEY SHARE must coexist with the House's FOR NO KEY UPDATE lock.
        await raw.query(`SELECT id FROM "House" WHERE id='a' FOR KEY SHARE NOWAIT`);
        await raw.query("ROLLBACK");
        for (const table of ["House", "Fund"]) {
          await raw.query("BEGIN");
          await expect(raw.query(`SELECT id FROM "${table}" WHERE id='a' FOR UPDATE NOWAIT`))
            .rejects.toMatchObject({ code: "55P03" });
          await raw.query("ROLLBACK");
        }
      } finally {
        await raw.query("ROLLBACK"); release.open(); expect(await holder).toBeUndefined();
      }
    });
  }, 60000);

  it.each(["RepeatableRead", "Serializable"] as const)("rejects stale %s scope acquisition", async (isolationLevel) => {
    await fixture(async (prisma) => {
      const snapshot = barrier(); const competingCommit = barrier();
      const stale = prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT revision FROM "VillageFinancialWriteLock" WHERE "villageId"='a'`;
        snapshot.open(); await competingCommit.reached;
        await acquireVillageScopes(tx, ["a"]);
      }, { isolationLevel, timeout: 15000 }).then(() => undefined, (error: unknown) => {
        snapshot.open(); return error;
      });
      try {
        await snapshot.reached;
        await prisma.$transaction((tx) => acquireVillageScopes(tx, ["a"]));
      } finally { competingCommit.open(); }
      expect(inspectDatabaseError(await stale)).toMatchObject({ sqlStates: ["40001"], retryable: true });
    });
  }, 60000);

  it.each(["40001", "40P01"])("retries confirmed commit-time %s with no first-attempt writes surviving", async (code) => {
    await fixture(async (prisma, raw) => {
      // Test-only objects in the disposable database. Failure is raised by the
      // deferred trigger during COMMIT, after the Prisma callback has returned.
      await raw.query(`CREATE TABLE vfc_retry_probe (id integer PRIMARY KEY, fail boolean NOT NULL)`);
      await raw.query(`CREATE FUNCTION vfc_retry_probe_check() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.fail THEN RAISE EXCEPTION USING ERRCODE='${code}', MESSAGE='VFC_TEST_COMMIT_ABORT'; END IF; RETURN NEW; END $$`);
      await raw.query(`CREATE CONSTRAINT TRIGGER vfc_retry_probe_commit AFTER INSERT ON vfc_retry_probe
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION vfc_retry_probe_check()`);
      let attempts = 0;
      let callbacksReturned = 0;
      const before = await raw.query<{ revision: string }>(`SELECT revision FROM "VillageFinancialWriteLock" WHERE "villageId"='a'`);
      const result = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
        attempts += 1;
        await acquireVillageScopes(tx, ["a"]);
        await tx.$executeRaw`INSERT INTO vfc_retry_probe(id,fail) VALUES (1,${attempts === 1})`;
        callbacksReturned += 1;
        return "committed";
      }));
      expect(result).toBe("committed"); expect(attempts).toBe(2); expect(callbacksReturned).toBe(2);
      expect((await raw.query('SELECT * FROM vfc_retry_probe')).rows).toEqual([{ id: 1, fail: false }]);
      const after = await raw.query<{ revision: string }>(`SELECT revision FROM "VillageFinancialWriteLock" WHERE "villageId"='a'`);
      expect(BigInt(after.rows[0].revision) - BigInt(before.rows[0].revision)).toBe(BigInt(1));
    });
  }, 60000);
});
