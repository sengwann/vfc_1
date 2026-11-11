/** Authored only. Disposable PostgreSQL opt-in; never a production target. */
import type { Client } from "pg";
import { withSerializableRetry } from "../db/transaction";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { disposable, migration } from "@/features/fund-management/lib/fund-migration-test-support";
import { getSessionIdentity } from "../auth/session-identity";
import { authorizeFinancialTransaction } from "./transaction-authority";
import { createFinancialAudit } from "../audit/financial-audit";
import { inspectDatabaseError } from "../db/database-errors";
// Only the signed-cookie boundary is substituted; all transactional reads,
// locking, audit insertion, constraints and rollback use the real database.
vi.mock("../auth/session-identity", () => ({ getSessionIdentity: vi.fn() }));
const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.VFC_ALLOW_MIGRATION_TESTS === "1";
async function fixture(run: (prisma: PrismaClient, raw: Client) => Promise<void>) {
  await disposable(async (raw, url) => {
    await raw.query(await migration());
    await raw.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ('v','v','Authority',now())`);
    await raw.query(`INSERT INTO "User"(id,"villageId",role,"membershipStatus",name,"passwordHash","updatedAt")
      VALUES ('actor','v','CHIEF','ACTIVE','Actor','unused',now())`);
    await raw.query(`INSERT INTO "CollectorAssignment"(id,"userId","villageId",year,month,"updatedAt")
      VALUES ('assignment','actor','v',extract(year from clock_timestamp() AT TIME ZONE 'Asia/Yangon'),
      extract(month from clock_timestamp() AT TIME ZONE 'Asia/Yangon'),now())`);
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    vi.mocked(getSessionIdentity).mockResolvedValue({ userId: "actor", sessionVersion: 0 });
    try { await run(prisma, raw); } finally { await prisma.$disconnect(); }
  });
}
function barrier() {
  let open!: () => void;
  const reached = new Promise<void>((resolve) => { open = resolve; });
  return { reached, open };
}
const revocations = [
  { label: "assignment", permission: "collector", code: "VFC_AUTH_COLLECTOR", table: "CollectorAssignment", id: "assignment", sql: `UPDATE "CollectorAssignment" SET "isActive"=false WHERE id='assignment'` },
  { label: "session version", permission: "chief", code: "VFC_AUTH_SESSION", table: "User", id: "actor", sql: `UPDATE "User" SET "sessionVersion"="sessionVersion"+1 WHERE id='actor'` },
  { label: "membership", permission: "chief", code: "VFC_AUTH_MEMBERSHIP", table: "User", id: "actor", sql: `UPDATE "User" SET "membershipStatus"='REMOVED' WHERE id='actor'` },
  { label: "role", permission: "chief", code: "VFC_AUTH_ROLE", table: "User", id: "actor", sql: `UPDATE "User" SET role='VILLAGER' WHERE id='actor'` },
] as const;
async function revoke(raw: Client, sql: string) {
  await raw.query("BEGIN");
  try {
    await raw.query("SELECT public.vfc_acquire_villages(ARRAY['v']::text[])");
    await raw.query(sql);
    await raw.query("COMMIT");
  } finally { await raw.query("ROLLBACK"); }
}
describe.skipIf(!enabled)("Phase 3B authority and mandatory audit", () => {
  it("rejects a revoked assignment even for an active Chief", async () => {
    await fixture(async (prisma) => {
      await prisma.collectorAssignment.update({ where: { id: "assignment" }, data: { isActive: false } });
      await expect(prisma.$transaction((tx) => authorizeFinancialTransaction(tx, { villageId: "v", permission: "collector" })))
        .rejects.toMatchObject({ code: "VFC_AUTH_COLLECTOR" });
    });
  }, 60000);
  it("rechecks membership and password restrictions in the database", async () => {
    await fixture(async (prisma) => {
      await prisma.user.update({ where: { id: "actor" }, data: { membershipStatus: "REMOVED" } });
      await expect(prisma.$transaction((tx) => authorizeFinancialTransaction(tx, { villageId: "v", permission: "chief" })))
        .rejects.toMatchObject({ code: "VFC_AUTH_MEMBERSHIP" });
      await prisma.user.update({ where: { id: "actor" }, data: { membershipStatus: "ACTIVE", mustChangePassword: true } });
      await expect(prisma.$transaction((tx) => authorizeFinancialTransaction(tx, { villageId: "v", permission: "chief" })))
        .rejects.toMatchObject({ code: "VFC_AUTH_PASSWORD_CHANGE" });
    });
  }, 60000);
  it("commits the Fund and its correctly linked mandatory audit together", async () => {
    await fixture(async (prisma) => {
      await prisma.$transaction(async (tx) => {
        const authority = await authorizeFinancialTransaction(tx, { villageId: "v", permission: "chief" });
        await tx.fund.create({ data: { id: "fund", villageId: "v", name: "Draft", villageTargetAmount: 1001, startDate: new Date("2026-01-01"), endDate: new Date("2026-01-02") } });
        await createFinancialAudit(tx, { actorUserId: authority.actor.id, villageId: authority.villageId, fundId: "fund", event: "DRAFT_CREATED", metadata: { villageTargetAmount: 1001, termsVersion: 1 } });
      });
      expect(await prisma.auditLog.findFirst({ where: { fundId: "fund" } })).toMatchObject({ actorUserId: "actor", villageId: "v", entityType: "FUND", entityId: "fund" });
    });
  }, 60000);
  it("rolls back the preceding Fund write when mandatory audit insertion fails", async () => {
    await fixture(async (prisma) => {
      let businessInserted = false;
      const failure = await prisma.$transaction(async (tx) => {
        await authorizeFinancialTransaction(tx, { villageId: "v", permission: "chief" });
        await tx.fund.create({ data: { id: "rolled-back", villageId: "v", name: "Draft", villageTargetAmount: 1001, startDate: new Date("2026-01-01"), endDate: new Date("2026-01-02") } });
        expect(await tx.fund.findUnique({ where: { id: "rolled-back" } })).toMatchObject({ id: "rolled-back", villageId: "v" });
        businessInserted = true;
        // Missing actor fails the actual AuditLog FK after the Fund INSERT.
        await createFinancialAudit(tx, { actorUserId: "missing", villageId: "v", fundId: "rolled-back", event: "DRAFT_CREATED", metadata: { villageTargetAmount: 1001, termsVersion: 1 } });
      }).then(() => undefined, (error: unknown) => error);
      expect(businessInserted).toBe(true);
      const diagnostic = inspectDatabaseError(failure);
      expect(diagnostic.sqlStates.includes("23503") || diagnostic.prismaCodes.includes("P2003")).toBe(true);
      // Exact pg constraint name, or Prisma's AuditLog model plus the adapter's
      // structured FK field identity. Never accept an arbitrary P2003 alone.
      const outer = failure as { meta?: { modelName?: string } };
      const pending: unknown[] = [failure];
      const seen = new Set<object>();
      let actorField = false;
      for (let i = 0; i < 32 && pending.length; i += 1) {
        const value = pending.shift();
        if (!value || typeof value !== "object" || seen.has(value)) continue;
        seen.add(value);
        const node = value as Record<string, unknown>;
        if (node.field_name === "AuditLog_actorUserId_fkey") actorField = true;
        const constraint = node.constraint as { fields?: unknown } | undefined;
        if (constraint && JSON.stringify(constraint.fields) === JSON.stringify(["actorUserId"])) actorField = true;
        const meta = node.meta as Record<string, unknown> | undefined;
        pending.push(node.cause, node.originalError, node.meta, meta?.driverAdapterError);
      }
      expect(diagnostic.constraints.includes("AuditLog_actorUserId_fkey")
        || (outer.meta?.modelName === "AuditLog" && actorField)).toBe(true);
      expect(await prisma.fund.findUnique({ where: { id: "rolled-back" } })).toBeNull();
      expect(await prisma.auditLog.count({ where: { fundId: "rolled-back" } })).toBe(0);
    });
  }, 60000);
  it.each(revocations)("authorization completes before competing $label revocation", async (change) => {
    await fixture(async (prisma, raw) => {
      const authorized = barrier(); const release = barrier();
      // Prisma and raw use independent connections. Observe rejection immediately
      // to avoid unhandled promises and ensure every failure releases the barrier.
      const holder = prisma.$transaction(async (tx) => {
        const result = await authorizeFinancialTransaction(tx, { villageId: "v", permission: change.permission });
        authorized.open(); await release.reached;
        return result.actor.id;
      }, { timeout: 15000 }).then((id) => ({ id }), (error: unknown) => { authorized.open(); return { error }; });
      try {
        await authorized.reached;
        await raw.query("BEGIN");
        // Legacy/no-scope lock probe proves the actual authority row is protected.
        // Table names are fixed test constants, never externally supplied SQL.
        await expect(raw.query(`SELECT id FROM "${change.table}" WHERE id=$1 FOR UPDATE NOWAIT`, [change.id]))
          .rejects.toMatchObject({ code: "55P03" });
        await raw.query("ROLLBACK");
        await raw.query("BEGIN");
        await expect(raw.query("SELECT public.vfc_acquire_villages(ARRAY['v']::text[])"))
          .rejects.toMatchObject({ code: "40001", message: "VFC_SCOPE_BUSY_RETRY_TRANSACTION" });
        await raw.query("ROLLBACK");
      } finally {
        await raw.query("ROLLBACK"); release.open();
        expect(await holder).toEqual({ id: "actor" });
      }
      // Retry the competing operation only after authorization has committed.
      await revoke(raw, change.sql);
      await expect(prisma.$transaction((tx) => authorizeFinancialTransaction(tx, { villageId: "v", permission: change.permission })))
        .rejects.toMatchObject({ code: change.code });
    });
  }, 60000);

  it.each(revocations)("committed $label revocation is rechecked after a stale transaction retries", async (change) => {
    await fixture(async (prisma, raw) => {
      const snapshot = barrier(); const committed = barrier();
      let attempts = 0;
      const abortStates: string[][] = [];
      vi.mocked(getSessionIdentity).mockClear();
      const operation = withSerializableRetry(() => prisma.$transaction(async (tx) => {
        attempts += 1;
        if (attempts === 1) {
          // Test-only snapshot establishment; this value is never authority.
          await tx.$queryRaw`SELECT id FROM public."Village" WHERE id='v'`;
          snapshot.open(); await committed.reached;
        }
        return authorizeFinancialTransaction(tx, { villageId: "v", permission: change.permission });
      }, { isolationLevel: "Serializable", timeout: 15000 }).catch((error: unknown) => {
        abortStates.push([...inspectDatabaseError(error).sqlStates]); throw error;
      })).then(() => undefined, (error: unknown) => { snapshot.open(); return error; });
      try {
        await snapshot.reached;
        await revoke(raw, change.sql);
      } finally { committed.open(); }
      expect(await operation).toMatchObject({ code: change.code });
      expect(attempts).toBe(2);
      expect(abortStates[0]).toContain("40001");
      expect(getSessionIdentity).toHaveBeenCalledTimes(2);
      // A fresh attempt after the revocation must independently deny authority.
      await expect(prisma.$transaction((tx) => authorizeFinancialTransaction(tx, { villageId: "v", permission: change.permission })))
        .rejects.toMatchObject({ code: change.code });
    });
  }, 60000);

});
