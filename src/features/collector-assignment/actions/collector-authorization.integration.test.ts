/** Authored only: opt-in disposable PostgreSQL, never a production database.
 * Actual actions, authorization, locks, retries and audits. Only preflight
 * identity/navigation/global-client boundaries and explicit clock cases below
 * are substituted. Payment fixture uses Phase 3B authority, not legacy actions.
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it, vi } from "vitest";
import { disposable, migration } from "@/features/fund-management/lib/fund-migration-test-support";
import { activate } from "@/features/fund-management/lib/fund-schema-test-support";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import { getCurrentPeriod } from "@/lib/authz/collector-period";
import { authorizeFinancialTransaction } from "@/lib/authz/transaction-authority";
import { beginHouseholdWrite } from "@/features/household-management/lib/household-write";
import { removeMemberAndDeactivateAssignments } from "@/features/household-management/lib/remove-member-transaction";
import { withSerializableRetry } from "@/lib/db/transaction";
import { inspectDatabaseError } from "@/lib/db/database-errors";
import { createFinancialAudit } from "@/lib/audit/financial-audit";
import { assignCollectorAction } from "./assign-collector.action";
import { deactivateCollectorAssignmentAction } from "./deactivate-collector-assignment.action";
const boundary = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  before: null as null | ((tx: Prisma.TransactionClient) => Promise<void>),
  after: null as null | (() => Promise<void>),
  clock: null as Date | null,
}));
vi.mock("@/lib/authz", async () => ({
  requireChief: async () => ({ user: { id: "chief" }, villageId: "v" }),
  getCurrentPeriod: (await import("@/lib/authz/collector-period")).getCurrentPeriod,
}));
vi.mock("@/lib/auth/session-identity", () => ({ getSessionIdentity: vi.fn() }));
class Navigation extends Error { constructor(readonly path: string) { super(path); } }
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Navigation(path); } }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get(_target, key) {
  const client = boundary.client!;
  if (key === "$transaction") return (body: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => client.$transaction(async (real) => {
    const tx = clockClient(real);
    await boundary.before?.(tx);
    const result = await body(tx);
    await boundary.after?.();
    return result;
  }, { ...options, timeout: 15000 });
  const value = Reflect.get(client, key);
  return typeof value === "function" ? value.bind(client) : value;
} }) }));
// Explicit clock substitution is local to this test client. All other SQL runs
// unchanged. It does not override any production trigger's database clock.
function clockClient(tx: Prisma.TransactionClient): Prisma.TransactionClient {
  return new Proxy(tx, { get(target, key) {
    if (key === "$queryRaw" && boundary.clock) return (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.join("").trim() === "SELECT clock_timestamp() AS now"
        ? target.$queryRaw`SELECT ${boundary.clock}::timestamptz AS now`
        : target.$queryRaw(strings, ...values);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.VFC_ALLOW_MIGRATION_TESTS === "1";
function barrier() { let open!: () => void; const reached = new Promise<void>((resolve) => { open = resolve; }); return { open, reached }; }
function observe<T>(promise: Promise<T>) { return promise.then((value) => ({ value }), (error: unknown) => ({ error })); }
async function reached<T>(gate: ReturnType<typeof barrier>, pending: ReturnType<typeof observe<T>>) {
  await Promise.race([gate.reached, pending.then((out) => { if ("error" in out) throw out.error; throw new Error("Operation ended before barrier"); })]);
}
function identity(id = "chief") { vi.mocked(getSessionIdentity).mockResolvedValue({ userId: id, sessionVersion: 0 }); }
function form(userId = "collector", period = getCurrentPeriod()) {
  const data = new FormData(); data.set("userId", userId); data.set("year", String(period.year)); data.set("month", String(period.month)); return data;
}
function deactivate() { const data = new FormData(); data.set("assignmentId", "assignment"); return deactivateCollectorAssignmentAction(data); }
async function deactivated() { await expect(deactivate()).rejects.toMatchObject({ path: "/village/collectors" }); }
const transaction = <T>(p: PrismaClient, body: (tx: Prisma.TransactionClient) => Promise<T>) => withSerializableRetry(() => p.$transaction(body, { isolationLevel: "Serializable", timeout: 15000 }));
async function fixture(run: (p: PrismaClient, other: PrismaClient, raw: import("pg").Client) => Promise<void>) {
  await disposable(async (raw, url) => {
    await raw.query(await migration());
    await raw.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ('v','v','Test',now())`);
    await raw.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ('v','v','H1',now())`);
    await raw.query(`INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt") VALUES
      ('chief','v',NULL,'CHIEF','ACTIVE','Chief','unused',now()),
      ('head','v','v','VILLAGER','ACTIVE','Head','unused',now()),
      ('collector','v','v','VILLAGER','ACTIVE','Collector','unused',now()),
      ('alternate','v','v','VILLAGER','ACTIVE','Alternate','unused',now())`);
    await raw.query(`UPDATE "House" SET "headOfHouseId"='head' WHERE id='v'`);
    const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const other = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    boundary.client = p; boundary.before = null; boundary.after = null; boundary.clock = null; identity();
    let failed = false;
    try { await run(p, other, raw); } catch (error) { failed = true; throw error; }
    finally {
      boundary.before = null; boundary.after = null; boundary.clock = null; boundary.client = null;
      const results = await Promise.allSettled([p.$disconnect(), other.$disconnect()]);
      for (const result of results) if (result.status === "rejected") { if (!failed) throw result.reason; console.error("Collector fixture cleanup failed", result.reason); }
    }
  });
}
async function assignment(p: PrismaClient) {
  const period = getCurrentPeriod();
  await p.collectorAssignment.create({ data: { id: "assignment", villageId: "v", userId: "collector", ...period } });
}
async function payment(tx: Prisma.TransactionClient) {
  await authorizeFinancialTransaction(tx, { villageId: "v", permission: "collector", fundIds: ["v"], houseIds: ["v"] });
  await tx.payment.create({ data: { id: "payment", villageId: "v", fundId: "v", houseId: "v", fundHouseAssessmentId: "v", payerUserId: "head", collectorUserId: "collector", amount: 1001 } });
  await tx.receipt.create({ data: { id: "receipt", receiptNumber: "TEST-RECEIPT", paymentId: "payment", villageId: "v" } });
  await createFinancialAudit(tx, { event: "PAYMENT_CREATED", villageId: "v", fundId: "v", actorUserId: "collector", metadata: { paymentId: "payment", houseId: "v", assessmentId: "v", amount: 1001 } });
  await createFinancialAudit(tx, { event: "RECEIPT_CREATED", villageId: "v", fundId: "v", actorUserId: "collector", metadata: { paymentId: "payment", receiptId: "receipt", receiptNumber: "TEST-RECEIPT" } });
}
describe.skipIf(!enabled)("Phase 3E collector transactions", () => {
  it.each([
    ["role", "assign"], ["membership", "assign"], ["role", "deactivate"], ["membership", "deactivate"],
  ] as const)("committed Chief %s revocation is rechecked by %s after a complete retry", async (change, operation) => {
    await fixture(async (p, _other, raw) => {
      if (operation === "deactivate") await assignment(p);
      const snapshot = barrier(); const release = barrier(); let attempts = 0;
      boundary.before = async (tx) => { attempts += 1; if (attempts === 1) { await tx.$queryRaw`SELECT id FROM "Village" WHERE id='v'`; snapshot.open(); await release.reached; } };
      const pending = observe((async () => operation === "assign" ? await assignCollectorAction(form()) : await deactivate())());
      try {
        await reached(snapshot, pending);
        await raw.query("BEGIN");
        await raw.query(`SELECT public.vfc_acquire_villages(ARRAY['v']::text[])`);
        await raw.query(change === "role" ? `UPDATE "User" SET role='VILLAGER' WHERE id='chief'` : `UPDATE "User" SET "membershipStatus"='REMOVED' WHERE id='chief'`);
        await raw.query("COMMIT"); release.open();
        expect(await pending).toMatchObject({ error: { path: "/forbidden" } });
        expect(attempts).toBe(2);
        expect(await p.collectorAssignment.count({ where: { isActive: true } })).toBe(operation === "assign" ? 0 : 1);
        expect(await p.auditLog.count()).toBe(0);
      } finally { release.open(); await raw.query("ROLLBACK").catch((error: unknown) => console.error("Rollback cleanup failed", error)); await pending; }
    });
  }, 60000);
  it("an assignment change holding authority commits before later Chief revocation", async () => {
    await fixture(async (p, _other, raw) => {
      const written = barrier(); const release = barrier();
      boundary.after = async () => { written.open(); await release.reached; };
      const pending = observe(assignCollectorAction(form()));
      try {
        await reached(written, pending);
        await raw.query("BEGIN");
        await expect(raw.query(`SELECT public.vfc_acquire_villages(ARRAY['v']::text[])`)).rejects.toMatchObject({ code: "40001", message: "VFC_SCOPE_BUSY_RETRY_TRANSACTION" });
        await raw.query("ROLLBACK"); release.open();
        expect(await pending).toEqual({ value: { success: true } }); boundary.after = null;
        await raw.query(`UPDATE "User" SET role='VILLAGER' WHERE id='chief'`);
        await expect(assignCollectorAction(form("alternate"))).rejects.toMatchObject({ path: "/forbidden" });
        expect(await p.collectorAssignment.count({ where: { isActive: true } })).toBe(1);
        expect(await p.auditLog.count({ where: { actionType: "ASSIGN" } })).toBe(1);
      } finally { release.open(); await raw.query("ROLLBACK").catch((error: unknown) => console.error("Rollback cleanup failed", error)); await pending; }
    });
  }, 60000);
  it("simultaneous assignment actions serialize and preserve a single assignment and audit", async () => {
    await fixture(async (p, _other, raw) => {
      const written = barrier(); const release = barrier();
      boundary.after = async () => { written.open(); await release.reached; };
      const first = observe(assignCollectorAction(form()));
      let second: ReturnType<typeof observe<Awaited<ReturnType<typeof assignCollectorAction>>>> | undefined;
      try {
        await reached(written, first);
        // Probe the exact NOWAIT abort, then start a stale action snapshot on
        // another independent connection; release only after it is established.
        await raw.query("BEGIN");
        await expect(raw.query(`SELECT public.vfc_acquire_villages(ARRAY['v']::text[])`)).rejects.toMatchObject({ code: "40001", message: "VFC_SCOPE_BUSY_RETRY_TRANSACTION" });
        await raw.query("ROLLBACK");
        const snapshot = barrier(); const committed = barrier(); let attempts = 0;
        boundary.client = _other;
        boundary.before = async (tx) => { attempts += 1; if (attempts === 1) { await tx.$queryRaw`SELECT id FROM "Village" WHERE id='v'`; snapshot.open(); await committed.reached; } };
        second = observe(assignCollectorAction(form("alternate")));
        try {
          await reached(snapshot, second); release.open();
          expect(await first).toEqual({ value: { success: true } }); boundary.after = null; committed.open();
          expect(await second).toMatchObject({ value: { success: false, formError: "An active Collector already exists for the selected period. Deactivate the existing assignment first." } });
          expect(attempts).toBe(2);
          expect(await p.collectorAssignment.count({ where: { isActive: true } })).toBe(1);
          expect(await p.auditLog.count({ where: { actionType: "ASSIGN" } })).toBe(1);
        } finally { committed.open(); }
      } finally { release.open(); await raw.query("ROLLBACK").catch((error: unknown) => console.error("Rollback cleanup failed", error)); await first; await second; }
    });
  }, 60000);
  it.each(["revocation-first", "payment-first"] as const)("%s preserves transactional payment authority and history", async (ordering) => {
    await fixture(async (p, other, raw) => {
      await assignment(p);
      await raw.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") VALUES ('v','v','Test',1001,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date-1,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date+1,now())`);
      await raw.query("BEGIN"); await activate(raw, "v"); await raw.query("COMMIT");
      if (ordering === "revocation-first") {
        await deactivated(); identity("collector");
        await expect(transaction(other, payment)).rejects.toMatchObject({ code: "VFC_AUTH_COLLECTOR" });
        expect(await p.payment.count()).toBe(0); expect(await p.receipt.count()).toBe(0);
      } else {
        identity("collector"); const written = barrier(); const release = barrier();
        const pending = observe(transaction(other, async (tx) => { await payment(tx); written.open(); await release.reached; }));
        try {
          await reached(written, pending); identity();
          await raw.query("BEGIN");
          await expect(raw.query(`SELECT public.vfc_acquire_villages(ARRAY['v']::text[])`)).rejects.toMatchObject({ code: "40001", message: "VFC_SCOPE_BUSY_RETRY_TRANSACTION" });
          await raw.query("ROLLBACK"); release.open(); expect(await pending).toEqual({ value: undefined });
          await deactivated();
          expect(await p.payment.findUnique({ where: { id: "payment" } })).toMatchObject({ status: "ACCEPTED", collectorUserId: "collector" });
          expect(await p.receipt.findUnique({ where: { id: "receipt" } })).toMatchObject({ status: "ACTIVE" });
          expect(await p.auditLog.count({ where: { fundId: "v" } })).toBe(2);
        } finally { release.open(); await raw.query("ROLLBACK").catch((error: unknown) => console.error("Rollback cleanup failed", error)); await pending; }
      }
      expect(await p.collectorAssignment.findUnique({ where: { id: "assignment" } })).toMatchObject({ isActive: false });
      expect(await p.auditLog.count({ where: { entityId: "assignment", actionType: "STATUS_CHANGE" } })).toBe(1);
    });
  }, 60000);
  it("member removal and Chief deactivation serialize without duplicate revocation audits", async () => {
    await fixture(async (p, other, raw) => {
      await assignment(p); identity("head");
      const written = barrier(); const release = barrier();
      const pending = observe(transaction(other, async (tx) => {
        const guard = await beginHouseholdWrite(tx, { villageId: "v", permission: "head", actorUserId: "head", houseIds: ["v"], targetUserIds: ["collector"], deactivateAssignmentsFor: "collector" });
        expect(guard.ok).toBe(true);
        await removeMemberAndDeactivateAssignments(tx, { villageId: "v", houseId: "v", actorUserId: "head", targetUserId: "collector", currentPeriod: getCurrentPeriod() });
        written.open(); await release.reached;
      }));
      try {
        await reached(written, pending); identity();
        await raw.query("BEGIN");
        await expect(raw.query(`SELECT public.vfc_acquire_villages(ARRAY['v']::text[])`)).rejects.toMatchObject({ code: "40001", message: "VFC_SCOPE_BUSY_RETRY_TRANSACTION" });
        await raw.query("ROLLBACK"); release.open(); expect(await pending).toEqual({ value: undefined }); await deactivated();
        expect(await p.user.findUnique({ where: { id: "collector" } })).toMatchObject({ membershipStatus: "REMOVED" });
        expect(await p.collectorAssignment.findUnique({ where: { id: "assignment" } })).toMatchObject({ isActive: false });
        expect(await p.auditLog.count({ where: { entityId: "assignment" } })).toBe(1);
        expect(await p.auditLog.count({ where: { entityId: "collector", actionType: "REMOVE" } })).toBe(1);
      } finally { release.open(); await raw.query("ROLLBACK").catch((error: unknown) => console.error("Rollback cleanup failed", error)); await pending; }
    });
  }, 60000);
  it.each(["removed", "chief", "missing"] as const)("rejects an ineligible %s target without assignment or audit writes", async (kind) => {
    await fixture(async (p) => {
      if (kind === "removed") await p.user.update({ where: { id: "collector" }, data: { membershipStatus: "REMOVED" } });
      if (kind === "chief") await p.user.update({ where: { id: "collector" }, data: { role: "CHIEF" } });
      expect(await assignCollectorAction(form(kind === "missing" ? "absent" : "collector")))
        .toMatchObject({ success: false, fieldErrors: { userId: "Selected user is not an active member of this village." } });
      expect(await p.collectorAssignment.count()).toBe(0);
      expect(await p.auditLog.count()).toBe(0);
    });
  }, 60000);
  it("rechecks assignment/deactivation periods at the Yangon month rollover", async () => {
    await fixture(async (p) => {
      await assignment(p);
      const period = getCurrentPeriod();
      const after = new Date(Date.UTC(period.year, period.month, 1, -6, -30));
      const before = new Date(after.getTime() - 1);
      expect(getCurrentPeriod(before)).toEqual(period);
      boundary.clock = after;
      expect(await assignCollectorAction(form("alternate", period))).toMatchObject({ success: false, fieldErrors: { month: "Cannot assign a collector for a past period." } });
      await deactivated(); // Past assignment remains active; no deactivation audit.
      expect(await p.collectorAssignment.findUnique({ where: { id: "assignment" } })).toMatchObject({ isActive: true });
      expect(await p.auditLog.count()).toBe(0);
      identity("collector");
      boundary.clock = before;
      expect(await transaction(p, (tx) => authorizeFinancialTransaction(clockClient(tx), { villageId: "v", permission: "collector" })))
        .toMatchObject({ assignmentId: "assignment" });
      boundary.clock = after;
      await expect(transaction(p, (tx) => authorizeFinancialTransaction(clockClient(tx), { villageId: "v", permission: "collector" })))
        .rejects.toMatchObject({ code: "VFC_AUTH_COLLECTOR" });
    });
  }, 60000);
});
