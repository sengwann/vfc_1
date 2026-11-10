/** Authored only. Requires opt-in disposable PostgreSQL; never a production URL. */
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it, vi } from "vitest";
import { disposable, migration } from "@/features/fund-management/lib/fund-migration-test-support";
import { activate } from "@/features/fund-management/lib/fund-schema-test-support";
import { acquireVillageScopes } from "@/lib/db/village-scope";
import { inspectDatabaseError } from "@/lib/db/database-errors";
import { withSerializableRetry } from "@/lib/db/transaction";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import { approveDeactivationRequestInTx, cancelDeactivationRequestInTx, completeDeactivationRequestInTx } from "@/features/village-deactivation/lib/deactivation-transitions";
import { createPrismaWorkerStore } from "@/features/village-deactivation/lib/deactivation-worker-store";
import { createVillageAction } from "../actions/create-village.action";
import { changeVillageStatus, changeVillageStatusInTx } from "./change-village-status";
vi.mock("@/lib/authz", () => ({ requireSystemAdmin: async () => ({ id: "admin" }) }));
vi.mock("@/lib/auth/password", () => ({ hashPassword: async () => "test-only-hash" }));
const db = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get(_t, key) { const p = db.client!; const value = Reflect.get(p, key); return typeof value === "function" ? value.bind(p) : value; } }) }));
vi.mock("@/lib/auth/session-identity", () => ({ getSessionIdentity: vi.fn() }));
const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.VFC_ALLOW_MIGRATION_TESTS === "1";
function barrier() { let open!: () => void; const reached = new Promise<void>((resolve) => { open = resolve; }); return { open, reached }; }
async function fixture(run: (p: PrismaClient, other: PrismaClient, raw: import("pg").Client) => Promise<void>) {
  await disposable(async (raw, url) => {
    await raw.query(await migration());
    await raw.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ('v','v','Village',now())`);
    await raw.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ('v','v','H1',now())`);
    await raw.query(`INSERT INTO "User"(id,role,name,"passwordHash","villageId","houseId","membershipStatus","updatedAt") VALUES ('chief','CHIEF','Chief','unused','v','v','ACTIVE',now()),('admin','SYSTEM_ADMIN','Admin','unused',NULL,NULL,NULL,now())`);
    await raw.query(`UPDATE "House" SET "headOfHouseId"='chief' WHERE id='v'`);
    await raw.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") VALUES ('v','v','Fund',1001,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date-3,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date-1,now())`);
    await raw.query(`INSERT INTO "VillageDeactivationRequest"(id,"villageId","requesterUserId",reason,"updatedAt") VALUES ('r','v','chief','closing',now())`);
    const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const other = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    db.client = p;
    vi.mocked(getSessionIdentity).mockResolvedValue({ userId: "admin", sessionVersion: 0 });
    let failed = false;
    try { await run(p, other, raw); } catch (error) { failed = true; throw error; }
    finally {
      db.client = null;
      const cleanup = await Promise.allSettled([p.$disconnect(), other.$disconnect()]);
      for (const out of cleanup) if (out.status === "rejected") { if (!failed) throw out.reason; console.error("Lifecycle fixture cleanup failed", out.reason); }
    }
  });
}
const transaction = <T>(p: PrismaClient, body: (tx: Prisma.TransactionClient) => Promise<T>) => withSerializableRetry(() => p.$transaction(body, { isolationLevel: "Serializable", timeout: 15000 }));
describe.skipIf(!enabled)("Phase 3D coordinated Village lifecycle", () => {
  it.each(["suspend", "approve"] as const)("expired ACTIVE Fund refuses %s", async (operation) => {
    await fixture(async (p, _other, raw) => {
      await raw.query("BEGIN"); await activate(raw, "v"); await raw.query("COMMIT");
      const result = operation === "suspend" ? await changeVillageStatus({ villageId: "v", actorUserId: "admin", action: "suspend", reason: null }) : await transaction(p, (tx) => approveDeactivationRequestInTx(tx, { requestId: "r", actorUserId: "admin" }));
      expect(result).toEqual(operation === "suspend" ? "blocked_by_active_fund" : { kind: "blocked", reason: "ACTIVE_FUND_EXISTS" });
      expect(await p.village.findUnique({ where: { id: "v" } })).toMatchObject({ status: "ACTIVE" });
      expect(await p.villageDeactivationRequest.findUnique({ where: { id: "r" } })).toMatchObject({ status: "PENDING", scheduledDeactivationAt: null });
      expect(await p.auditLog.count()).toBe(0);
    });
  }, 60000);
  it.each([
    ["suspend", false], ["approve", false], ["suspend", true], ["approve", true],
  ] as const)("activation racing %s retries (revocation=%s)", async (operation, revoke) => {
    await fixture(async (p, _other, raw) => {
      const snapshot = barrier(); const committed = barrier(); let attempts = 0;
      let pending: Promise<unknown> | undefined; let failed = false;
      try {
        pending = transaction(p, async (tx) => {
          attempts += 1;
          if (attempts === 1) { await tx.$queryRaw`SELECT id FROM "Village" WHERE id='v'`; snapshot.open(); await committed.reached; }
          if (operation === "approve") return approveDeactivationRequestInTx(tx, { requestId: "r", actorUserId: "admin" });
          return changeVillageStatusInTx(tx, { villageId: "v", actorUserId: "admin", action: "suspend", reason: null });
        });
        const observed = pending.then((value) => ({ value }), (error: unknown) => ({ error }));
        // Observe the rejection immediately, including failures before the barrier.
        pending = observed;
        await Promise.race([snapshot.reached, observed.then((outcome) => { if ("error" in outcome) throw outcome.error; throw new Error("Lifecycle operation ended before snapshot barrier"); })]);
        await raw.query("BEGIN"); await raw.query(`SELECT vfc_acquire_villages(ARRAY['v']::text[])`); await activate(raw, "v");
        if (revoke) await raw.query(`UPDATE "User" SET role='VILLAGER' WHERE id='admin'`);
        await raw.query("COMMIT");
        committed.open();
        expect(await observed).toEqual({ value: operation === "suspend"
          ? (revoke ? "forbidden" : "blocked_by_active_fund")
          : (revoke ? { kind: "forbidden" } : { kind: "blocked", reason: "ACTIVE_FUND_EXISTS" }) });
        expect(attempts).toBe(2);
        expect(await p.village.findUnique({ where: { id: "v" } })).toMatchObject({ status: "ACTIVE" });
        expect(await p.villageDeactivationRequest.findUnique({ where: { id: "r" } })).toMatchObject({ status: "PENDING" });
      } catch (error) { failed = true; throw error; }
      finally { committed.open(); try { await raw.query("ROLLBACK"); } catch (error) { if (!failed) throw error; console.error(error); } finally { await pending; } }
    });
  }, 60000);
  it("cancellation wins against a competing completion without blocking on NOWAIT", async () => {
    await fixture(async (p, other) => {
      const approved = await transaction(p, (tx) => approveDeactivationRequestInTx(tx, { requestId: "r", actorUserId: "admin" }));
      expect(approved.kind).toBe("approved");
      vi.mocked(getSessionIdentity).mockResolvedValue({ userId: "chief", sessionVersion: 0 });
      const written = barrier(); const release = barrier(); let pending: Promise<unknown> | undefined;
      try {
        pending = transaction(p, async (tx) => {
          const outcome = await cancelDeactivationRequestInTx(tx, { requestId: "r", actorUserId: "chief", villageId: "v", reason: "keep village" });
          written.open(); await release.reached; return outcome;
        });
        const observed = pending.then((value) => ({ value }), (error: unknown) => ({ error })); pending = observed;
        await Promise.race([written.reached, observed.then((outcome) => { if ("error" in outcome) throw outcome.error; throw new Error("Cancellation ended before barrier"); })]);
        const conflict = await other.$transaction((tx) => completeDeactivationRequestInTx(tx, { requestId: "r" })).then(() => undefined, (error: unknown) => error);
        expect(inspectDatabaseError(conflict).sqlStates).toContain("40001");
        expect(String(conflict)).toContain("VFC_SCOPE_BUSY_RETRY_TRANSACTION");
        release.open(); expect(await observed).toMatchObject({ value: { kind: "cancelled" } });
        expect(await transaction(other, (tx) => completeDeactivationRequestInTx(tx, { requestId: "r" }))).toEqual({ kind: "blocked", reason: "NOT_APPROVED" });
        expect(await p.village.findUnique({ where: { id: "v" } })).toMatchObject({ status: "ACTIVE" });
        expect(await p.villageDeactivationRequest.findUnique({ where: { id: "r" } })).toMatchObject({ status: "CANCELLED" });
      } finally { release.open(); await pending; }
    });
  }, 60000);
  it.each(["cancel", "complete"] as const)("deadline boundary: %s commits first", async (first) => {
    await fixture(async (p, other) => {
      const approved = await transaction(p, (tx) => approveDeactivationRequestInTx(tx, {
        requestId: "r", actorUserId: "admin", now: new Date("2000-01-01T00:00:00.000Z"),
      }));
      if (approved.kind !== "approved") throw new Error("Boundary fixture approval failed");
      const deadline = approved.scheduledDeactivationAt;
      const beforeDeadline = new Date(deadline.getTime() - 1);
      vi.mocked(getSessionIdentity).mockResolvedValue({ userId: "chief", sessionVersion: 0 });

      // Explicit instants model cancellation immediately before the deadline
      // and a genuinely due worker at the deadline, independent of wall time.
      const cancel = (tx: Prisma.TransactionClient) => cancelDeactivationRequestInTx(tx, {
        requestId: "r", actorUserId: "chief", villageId: "v", reason: "keep village", now: beforeDeadline,
      });
      const complete = (tx: Prisma.TransactionClient) => completeDeactivationRequestInTx(tx, {
        requestId: "r", now: deadline,
      });
      const firstOperation = first === "cancel" ? cancel : complete;
      const contender = first === "cancel" ? complete : cancel;
      const written = barrier();
      const release = barrier();
      let pending: Promise<unknown> | undefined;
      try {
        const started = transaction(p, async (tx) => {
          const result = await firstOperation(tx);
          expect(result.kind).toBe(first === "cancel" ? "cancelled" : "completed");
          written.open();
          await release.reached;
          return result;
        });
        // Attach a rejection handler before waiting for the barrier, so an
        // early failure is observed and cleanup can always release/await it.
        const observed = started.then((value) => ({ value }), (error: unknown) => ({ error }));
        pending = observed;
        await Promise.race([
          written.reached,
          observed.then((outcome) => {
            if ("error" in outcome) throw outcome.error;
            throw new Error("Boundary operation ended before its barrier");
          }),
        ]);
        const conflict = await other.$transaction(async (tx) => await contender(tx), { isolationLevel: "Serializable" })
          .then(() => undefined, (error: unknown) => error);
        expect(inspectDatabaseError(conflict).sqlStates).toContain("40001");
        expect(String(conflict)).toContain("VFC_SCOPE_BUSY_RETRY_TRANSACTION");

        // The contender's failed transaction has rolled back before the owner
        // is released. Its next attempt starts a completely fresh transaction.
        release.open();
        expect(await observed).toMatchObject({ value: { kind: first === "cancel" ? "cancelled" : "completed" } });
        expect(await transaction(other, async (tx) => await contender(tx)))
          .toEqual({ kind: "blocked", reason: "NOT_APPROVED" });
        expect(await p.villageDeactivationRequest.findUnique({ where: { id: "r" } })).toMatchObject({
          status: first === "cancel" ? "CANCELLED" : "COMPLETED",
          scheduledDeactivationAt: deadline,
          cancelledAt: first === "cancel" ? beforeDeadline : null,
          completedAt: first === "complete" ? deadline : null,
        });
        expect(await p.village.findUnique({ where: { id: "v" } }))
          .toMatchObject({ status: first === "cancel" ? "ACTIVE" : "DEACTIVATED" });
        const terminalAudits = await p.auditLog.findMany({
          where: { entityId: "r", actionType: { in: ["CANCEL", "COMPLETE"] } },
        });
        expect(terminalAudits).toHaveLength(1);
        expect(terminalAudits[0]).toMatchObject({
          actionType: first === "cancel" ? "CANCEL" : "COMPLETE",
          entityType: "DEACTIVATION_REQUEST", villageId: "v",
          actorUserId: first === "cancel" ? "chief" : null,
          metadata: { outcome: "SUCCESS", newStatus: first === "cancel" ? "CANCELLED" : "COMPLETED" },
        });
        expect(await p.auditLog.count()).toBe(4); // Two approval + two terminal events.
        expect(await p.auditLog.count({ where: { entityId: "v", actionType: "STATUS_CHANGE" } }))
          .toBe(first === "complete" ? 1 : 0);
      } finally {
        release.open();
        // observed never rejects; secondary operation failure cannot replace
        // an assertion failure. Both clients are idle before fixture disposal.
        await pending;
      }
    });
  }, 60000);
  it("bootstraps each new Village scope and fails closed when the row is missing", async () => {
    await fixture(async (p, _other, raw) => {
      const form = new FormData();
      for (const [key, value] of Object.entries({ villageCode: "NEW01", villageName: "New Village", chiefName: "New Chief", chiefEmail: "new@example.com", chiefPhone: "", chiefPassword: "initial-pass-1" })) form.set(key, value);
      const created = await createVillageAction(form);
      expect(created.success).toBe(true);
      if (!created.success) throw new Error("Village action failed");
      expect((await raw.query(`SELECT revision FROM "VillageFinancialWriteLock" WHERE "villageId"=$1`, [created.villageId])).rows).toHaveLength(1);
      expect(await p.user.findFirst({ where: { villageId: created.villageId } })).toMatchObject({ role: "CHIEF", membershipStatus: "ACTIVE", mustChangePassword: true });
      expect(await p.auditLog.count({ where: { villageId: created.villageId } })).toBe(2);
      // Owner-only corruption fixture in the disposable DB, never runtime grants.
      await raw.query(`DELETE FROM "VillageFinancialWriteLock" WHERE "villageId"=$1`, [created.villageId]);
      const failure = await p.$transaction((tx) => acquireVillageScopes(tx, [created.villageId])).then(() => undefined, (error: unknown) => error);
      expect(inspectDatabaseError(failure).sqlStates).toContain("P0001"); expect(String(failure)).toContain("VFC_SCOPE_MISSING");
    });
  }, 60000);
  it("lease claiming does not acquire a financial scope", async () => {
    await fixture(async (p, _other, raw) => {
      await transaction(p, (tx) => approveDeactivationRequestInTx(tx, { requestId: "r", actorUserId: "admin", now: new Date("2000-01-01") }));
      await raw.query("BEGIN"); await raw.query(`SELECT vfc_acquire_villages(ARRAY['v']::text[])`);
      try {
        expect(await p.$transaction((tx) => createPrismaWorkerStore(tx).claimDueRequests(1, 60))).toEqual(["r"]);
      } finally { await raw.query("ROLLBACK"); }
      expect(await p.villageDeactivationRequest.findUnique({ where: { id: "r" } })).toMatchObject({ status: "APPROVED", processingAttempts: 1 });
    });
  }, 60000);
});
