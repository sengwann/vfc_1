/** Authored only: opt-in disposable PostgreSQL; actual actions, authority, retries,
 * allocator, audit and constraints. Session/preflight/navigation/client routing
 * are test boundaries. Audit-failure case changes only the audit actor FK. */
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReceiptDetailPage from "@/app/(village)/village/receipts/[receiptId]/page";
import { TranslationProvider } from "@/lib/i18n/provider";
import { disposable, migration } from "@/features/fund-management/lib/fund-migration-test-support";
import { activate } from "@/features/fund-management/lib/fund-schema-test-support";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import { getCurrentPeriod } from "@/lib/authz/collector-period";
import { inspectDatabaseError } from "@/lib/db/database-errors";
import { recordCashPaymentAction } from "./record-cash-payment.action";
import { voidPaymentAction } from "./void-payment.action";
import { deactivateCollectorAssignmentAction } from "@/features/collector-assignment/actions/deactivate-collector-assignment.action";
const boundary = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  before: null as null | ((tx: Prisma.TransactionClient) => Promise<void>),
  after: null as null | (() => Promise<void>),
  auditFailure: false,
  replacementAuditFailure: false,
  replacementSeen: false,
  businessSeen: false,
  voidStateSeen: false,
}));
vi.mock("@/lib/authz", async () => ({
  requireChief: async () => ({ user: { id: "chief" }, villageId: "v" }),
  requireActiveCollector: async () => ({ villageId: "v" }),
  getCurrentPeriod: (await import("@/lib/authz/collector-period")).getCurrentPeriod,
  getActiveCollectorContext: (await import("@/lib/authz/collector")).getActiveCollectorContext,
}));
vi.mock("@/lib/auth/session-identity", () => ({ getSessionIdentity: vi.fn() }));
class Navigation extends Error { constructor(readonly path: string) { super(path); } }
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Navigation(path); }, notFound: () => { throw new Navigation("NOT_FOUND"); } }));
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
// The audit-failure case changes only the audit actor; all business SQL is real.
function clockClient(tx: Prisma.TransactionClient): Prisma.TransactionClient {
  return new Proxy(tx, { get(target, key) {
    if (key === "auditLog" && (boundary.auditFailure || boundary.replacementAuditFailure)) return new Proxy(target.auditLog, { get(delegate, method) {
      if (method === "create") return async (args: Prisma.AuditLogCreateArgs) => {
        if (boundary.replacementAuditFailure) {
          const metadata = args.data.metadata;
          if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || !("event" in metadata) || metadata.event !== "PAYMENT_REPLACED") return delegate.create(args);
          // Both replacement business inserts and their first two audit entries
          // succeeded inside this transaction before the replacement-link fails.
          boundary.replacementSeen = await target.payment.count() === 2 && await target.receipt.count() === 2 && await target.auditLog.count() === 6;
        }
        boundary.businessSeen = await target.payment.count() === 1;
        const payment = await target.payment.findFirst();
        const receipt = await target.receipt.findFirst();
        boundary.voidStateSeen = payment?.status === "VOIDED" && receipt?.status === "VOIDED";
        return delegate.create({ ...args, data: { ...(args.data as Prisma.AuditLogUncheckedCreateInput), actorUserId: "missing-audit-actor" } });
      };
      const value = Reflect.get(delegate, method); return typeof value === "function" ? value.bind(delegate) : value;
    } });
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
function expectAuditActorFailure(failure: unknown) {
  const diagnostic = inspectDatabaseError(failure);
  expect(diagnostic.retryable).toBe(false);
  expect(diagnostic.prismaCodes.includes("P2003") || diagnostic.sqlStates.includes("23503")).toBe(true);
  const outer = failure as { meta?: { modelName?: string } };
  const pending: unknown[] = [failure]; const seen = new Set<object>(); let actorField = false;
  for (let i = 0; i < 32 && pending.length; i++) {
    const value = pending.shift(); if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value); const node = value as Record<string, unknown>;
    if (node.field_name === "AuditLog_actorUserId_fkey") actorField = true;
    const constraint = node.constraint as { fields?: unknown } | undefined;
    if (constraint && JSON.stringify(constraint.fields) === JSON.stringify(["actorUserId"])) actorField = true;
    const meta = node.meta as Record<string, unknown> | undefined;
    pending.push(node.cause, node.originalError, node.meta, meta?.driverAdapterError);
  }
  expect(diagnostic.constraints.includes("AuditLog_actorUserId_fkey") || (outer.meta?.modelName === "AuditLog" && actorField)).toBe(true);
}
function identity(id = "chief") { vi.mocked(getSessionIdentity).mockResolvedValue({ userId: id, sessionVersion: 0 }); }
function form(overrides: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ fundId: "v", termsVersion: "2", houseId: "v", payerUserId: "head", amount: "1001", ...overrides })) data.set(key, value);
  return data;
}
function voidForm(paymentId: string) { const data = new FormData(); data.set("paymentId", paymentId); data.set("voidReason", "Incorrect payer recorded"); return data; }
function deactivate() { const data = new FormData(); data.set("assignmentId", "assignment"); return deactivateCollectorAssignmentAction(data); }
async function fixture(run: (p: PrismaClient, other: PrismaClient, raw: import("pg").Client) => Promise<void>, expired = false) {
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
    boundary.client = p; boundary.before = null; boundary.after = null; boundary.auditFailure = false; boundary.replacementAuditFailure = false; boundary.replacementSeen = false; boundary.businessSeen = false; boundary.voidStateSeen = false; identity("collector");
    let failed = false;
    try { await assignment(p);
      await raw.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") VALUES ('v','v','Test',1001,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date-2,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date+${expired ? -1 : 1},now())`);
      await raw.query("BEGIN"); await activate(raw, "v"); await raw.query("COMMIT");
      await run(p, other, raw); } catch (error) { failed = true; throw error; }
    finally {
      boundary.before = null; boundary.after = null; boundary.client = null;
      const results = await Promise.allSettled([p.$disconnect(), other.$disconnect()]);
      for (const result of results) if (result.status === "rejected") { if (!failed) throw result.reason; console.error("Collector fixture cleanup failed", result.reason); }
    }
  });
}
async function assignment(p: PrismaClient) {
  const period = getCurrentPeriod();
  await p.collectorAssignment.create({ data: { id: "assignment", villageId: "v", userId: "collector", ...period } });
}
const invalidPaymentInputs: Record<string, string>[] = [{ amount: "1000" }, { amount: "10000001" }, { fundId: "missing" }, { houseId: "missing" }, { termsVersion: "1" }];
describe.skipIf(!enabled)("Phase 3F payment transactions", () => {
  it.each(["record", "void"] as const)("rejects revoked collector authority for %s despite successful preflight", async (operation) => {
    await fixture(async (p) => {
      if (operation === "void") expect(await recordCashPaymentAction(form())).toEqual({ success: true });
      const existing = await p.payment.findFirst();
      await p.collectorAssignment.update({ where: { id: "assignment" }, data: { isActive: false } });
      const before = await p.auditLog.count();
      await expect(operation === "record" ? recordCashPaymentAction(form()) : voidPaymentAction(voidForm(existing!.id)))
        .rejects.toMatchObject({ path: "/forbidden" });
      expect(await p.auditLog.count()).toBe(before);
      expect(await p.payment.count({ where: { status: "VOIDED" } })).toBe(0);
      expect(await p.payment.count()).toBe(operation === "record" ? 0 : 1);
    });
  }, 60000);
  it.each(["role", "session"] as const)("rechecks changed %s on a real serialization retry", async (change) => {
    await fixture(async (p, _other, raw) => {
      const snapshot = barrier(), release = barrier(); let attempts = 0;
      boundary.before = async (tx) => { attempts++; if (attempts === 1) { await tx.$queryRaw`SELECT id FROM "Village" WHERE id='v'`; snapshot.open(); await release.reached; } };
      const pending = observe(recordCashPaymentAction(form()));
      try {
        await reached(snapshot, pending);
        await raw.query("BEGIN"); await raw.query(`SELECT public.vfc_acquire_villages(ARRAY['v']::text[])`);
        await raw.query(change === "role" ? `UPDATE "User" SET role='SYSTEM_ADMIN' WHERE id='collector'` : `UPDATE "User" SET "sessionVersion"=1 WHERE id='collector'`);
        await raw.query("COMMIT"); release.open();
        expect(await pending).toMatchObject({ error: { path: change === "role" ? "/forbidden" : "/login" } });
        expect(attempts).toBe(2); expect(await p.payment.count()).toBe(0); expect(await p.auditLog.count()).toBe(0);
      } finally { release.open(); await raw.query("ROLLBACK").catch(console.error); await pending; }
    });
  }, 60000);
  it.each(["payment-first", "deactivation-first"] as const)("actual payment/deactivation actions: %s", async (ordering) => {
    await fixture(async (p, other, raw) => {
      const written = barrier(), release = barrier(), snapshot = barrier(), committed = barrier();
      let attempts = 0;
      boundary.after = async () => { written.open(); await release.reached; };
      identity(ordering === "payment-first" ? "collector" : "chief");
      const first = observe<unknown>(ordering === "payment-first" ? recordCashPaymentAction(form()) : deactivate());
      let second: ReturnType<typeof observe<unknown>> | undefined;
      try {
        await reached(written, first);
        await raw.query("BEGIN");
        await expect(raw.query(`SELECT public.vfc_acquire_villages(ARRAY['v']::text[])`)).rejects.toMatchObject({ code: "40001", message: "VFC_SCOPE_BUSY_RETRY_TRANSACTION" });
        await raw.query("ROLLBACK");
        boundary.client = other;
        boundary.before = async (tx) => { attempts++; if (attempts === 1) { await tx.$queryRaw`SELECT id FROM "Village" WHERE id='v'`; snapshot.open(); await committed.reached; } };
        identity(ordering === "payment-first" ? "chief" : "collector");
        second = observe<unknown>(ordering === "payment-first" ? deactivate() : recordCashPaymentAction(form()));
        try {
          await reached(snapshot, second); release.open();
          const firstResult = await first;
          expect(firstResult).toMatchObject(ordering === "payment-first" ? { value: { success: true } } : { error: { path: "/village/collectors" } });
          boundary.after = null; committed.open();
          expect(await second).toMatchObject({ error: { path: ordering === "payment-first" ? "/village/collectors" : "/forbidden" } });
          expect(attempts).toBe(2);
          expect(await p.payment.count({ where: { status: "ACCEPTED" } })).toBe(ordering === "payment-first" ? 1 : 0);
          expect(await p.receipt.count({ where: { status: "ACTIVE" } })).toBe(ordering === "payment-first" ? 1 : 0);
          expect(await p.auditLog.count({ where: { fundId: "v" } })).toBe(ordering === "payment-first" ? 2 : 0);
          expect(await p.auditLog.count({ where: { entityId: "assignment" } })).toBe(1);
          expect(await p.collectorAssignment.findUnique({ where: { id: "assignment" } })).toMatchObject({ isActive: false });
        } finally { committed.open(); }
      } finally { release.open(); await raw.query("ROLLBACK").catch(console.error); await first; await second; }
    });
  }, 60000);
  it("rejects duplicate payment and preserves void/replacement history with linked audits", async () => {
    await fixture(async (p) => {
      expect(await recordCashPaymentAction(form({ amount: "10000000" }))).toEqual({ success: true });
      expect(await recordCashPaymentAction(form())).toMatchObject({ success: false, formError: "A valid payment already exists for this fund and house." });
      const first = (await p.payment.findFirst())!;
      const originalReceipt = (await p.receipt.findFirst())!;
      expect(await voidPaymentAction(voidForm(first.id))).toEqual({ success: true });
      expect(await p.receipt.findUnique({ where: { id: originalReceipt.id } })).toMatchObject({ id: originalReceipt.id, receiptNumber: originalReceipt.receiptNumber, paymentId: first.id, status: "VOIDED" });
      const historicalPage = await ReceiptDetailPage({ params: { receiptId: originalReceipt.id } });
      const html = renderToStaticMarkup(createElement(TranslationProvider, { language: "EN", children: historicalPage }));
      expect(html).toContain(originalReceipt.receiptNumber); expect(html).toContain("Incorrect payer recorded");
      expect(await voidPaymentAction(voidForm(first.id))).toMatchObject({ success: false, error: "Only accepted payments can be voided." });
      expect(await recordCashPaymentAction(form({ amount: "2000" }))).toEqual({ success: true });
      expect(await p.payment.count()).toBe(2); expect(await p.payment.count({ where: { status: "VOIDED" } })).toBe(1);
      expect(await p.receipt.count({ where: { status: "VOIDED" } })).toBe(1);
      const replacement = (await p.payment.findFirst({ where: { status: "ACCEPTED" }, include: { receipt: true } }))!;
      expect(replacement.id).not.toBe(first.id); expect(replacement.receipt?.id).not.toBe(originalReceipt.id);
      expect(replacement.receipt?.receiptNumber).not.toBe(originalReceipt.receiptNumber);
      expect(replacement.receipt).toMatchObject({ paymentId: replacement.id, villageId: "v", status: "ACTIVE" });
      expect(await p.payment.findUnique({ where: { id: first.id } })).toMatchObject({ status: "VOIDED", fundHouseAssessmentId: "v" });
      expect(await p.auditLog.count({ where: { fundId: "v" } })).toBe(7);
      const replacementAudit = await p.auditLog.findFirst({ where: { actionType: "CREATE", entityType: "PAYMENT", metadata: { path: ["event"], equals: "PAYMENT_REPLACED" } } });
      expect(replacementAudit).toMatchObject({ actorUserId: "collector", villageId: "v", fundId: "v", metadata: { previousPaymentId: first.id, houseId: "v", assessmentId: "v", amount: 2000 } });
    });
  }, 60000);
  it("replacement-link audit failure rolls back only the replacement transaction", async () => {
    await fixture(async (p) => {
      expect(await recordCashPaymentAction(form())).toEqual({ success: true });
      const original = (await p.payment.findFirst({ include: { receipt: true } }))!;
      expect(await voidPaymentAction(voidForm(original.id))).toEqual({ success: true });
      const auditsBefore = await p.auditLog.findMany({ orderBy: { id: "asc" } });
      expect(auditsBefore).toHaveLength(4);
      boundary.replacementAuditFailure = true;
      const result = await observe(recordCashPaymentAction(form({ amount: "2000" })));
      expect(boundary.replacementSeen).toBe(true);
      if (!("error" in result)) throw new Error("Expected replacement audit actor FK failure");
      expectAuditActorFailure(result.error);
      expect(await p.payment.count()).toBe(1); expect(await p.receipt.count()).toBe(1);
      expect(await p.payment.findUnique({ where: { id: original.id } })).toMatchObject({ status: "VOIDED", voidReason: "Incorrect payer recorded" });
      expect(await p.receipt.findUnique({ where: { id: original.receipt!.id } })).toMatchObject({ paymentId: original.id, receiptNumber: original.receipt!.receiptNumber, status: "VOIDED" });
      expect(await p.auditLog.findMany({ orderBy: { id: "asc" } })).toEqual(auditsBefore);
    });
  }, 60000);
  it.each(invalidPaymentInputs)("rejects invalid payment input %j without financial writes", async (input) => {
    await fixture(async (p) => {
      expect(await recordCashPaymentAction(form(input))).toMatchObject({ success: false });
      expect(await p.payment.count()).toBe(0); expect(await p.receipt.count()).toBe(0); expect(await p.auditLog.count()).toBe(0);
    });
  }, 60000);
  it("uses frozen assessment identity and excludes an eligible post-activation House", async () => {
    await fixture(async (p) => {
      await p.house.create({ data: { id: "new", villageId: "v", houseNumber: "H2" } });
      await p.user.create({ data: { id: "new-member", villageId: "v", houseId: "new", role: "VILLAGER", membershipStatus: "ACTIVE", name: "New", passwordHash: "unused" } });
      await p.house.update({ where: { id: "new" }, data: { headOfHouseId: "new-member" } });
      expect(await recordCashPaymentAction(form({ houseId: "new", payerUserId: "new-member" }))).toMatchObject({ success: false, formError: "This house has no assessment for the selected fund." });
      expect(await recordCashPaymentAction(form())).toEqual({ success: true });
      expect(await p.payment.findFirst()).toMatchObject({ fundId: "v", houseId: "v", villageId: "v", fundHouseAssessmentId: "v", amount: 1001 });
    });
  }, 60000);
  it("audit actor FK failure rolls back payment, receipt and audits after the business insert", async () => {
    await fixture(async (p) => {
      boundary.auditFailure = true;
      const outcome = await observe(recordCashPaymentAction(form()));
      expect(boundary.businessSeen).toBe(true); expect(outcome).toHaveProperty("error");
      if (!("error" in outcome)) throw new Error("Expected audit failure");
      expect(inspectDatabaseError(outcome.error).retryable).toBe(false);
      expectAuditActorFailure(outcome.error);
      expect(await p.payment.count()).toBe(0); expect(await p.receipt.count()).toBe(0); expect(await p.auditLog.count()).toBe(0);
    });
  }, 60000);
  it("Yangon end-of-day is inclusive and midnight closes the collection window", async () => {
    await fixture(async (_p, _other, raw) => {
      const result = await raw.query(`SELECT
        public.vfc_payment_window('2026-11-01'::date,'2026-11-08'::date,'2026-11-08T17:29:59.999Z'::timestamptz) AS last,
        public.vfc_payment_window('2026-11-01'::date,'2026-11-08'::date,'2026-11-08T17:30:00Z'::timestamptz) AS expired`);
      expect(result.rows[0]).toEqual({ last: true, expired: false });
    });
  }, 60000);
});

describe.skipIf(!enabled)("Phase 3F financial regression cases", () => {
  it("expired ACTIVE Fund rejects recording while retaining ACTIVE status", async () => {
    await fixture(async (p) => {
      expect(await recordCashPaymentAction(form())).toEqual({ success: false, formError: "This fund is not open for payment today." });
      expect(await p.fund.findUnique({ where: { id: "v" } })).toMatchObject({ status: "ACTIVE" });
      expect(await p.payment.count()).toBe(0); expect(await p.auditLog.count()).toBe(0);
    }, true);
  }, 60000);
  it("rejects cross-Village Fund and House identities without writes", async () => {
    await fixture(async (p) => {
      await p.village.create({ data: { id: "foreign", villageCode: "foreign", name: "Foreign" } });
      await p.house.create({ data: { id: "foreign", villageId: "foreign", houseNumber: "H1" } });
      await p.fund.create({ data: { id: "foreign", villageId: "foreign", name: "Foreign", villageTargetAmount: 1001, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31") } });
      expect(await recordCashPaymentAction(form({ fundId: "foreign" }))).toMatchObject({ success: false, formError: "Selected fund or house is not available." });
      expect(await recordCashPaymentAction(form({ houseId: "foreign" }))).toMatchObject({ success: false, formError: "Selected fund or house is not available." });
      expect(await p.payment.count()).toBe(0); expect(await p.auditLog.count()).toBe(0);
    });
  }, 60000);
  it("rolls back void and Receipt status changes when its audit fails", async () => {
    await fixture(async (p) => {
      expect(await recordCashPaymentAction(form())).toEqual({ success: true });
      const payment = (await p.payment.findFirst())!;
      boundary.auditFailure = true;
      const outcome = await observe(voidPaymentAction(voidForm(payment.id)));
      expect(boundary.businessSeen).toBe(true);
      expect(boundary.voidStateSeen).toBe(true);
      if (!("error" in outcome)) throw new Error("Expected audit actor FK failure");
      expectAuditActorFailure(outcome.error);
      expect(await p.payment.findUnique({ where: { id: payment.id } })).toMatchObject({ status: "ACCEPTED", voidReason: null });
      expect(await p.receipt.findFirst()).toMatchObject({ status: "ACTIVE" }); expect(await p.auditLog.count()).toBe(2);
    });
  }, 60000);
  it("confirmed database abort retries the complete real action without duplicate receipts or audits", async () => {
    await fixture(async (p, _other, raw) => {
      // Sequence increments survive rollback: exactly the first audit insert
      // aborts. No production trigger is disabled or replaced.
      await raw.query(`CREATE SEQUENCE test_payment_abort_counter;
        CREATE FUNCTION test_payment_abort() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF nextval('test_payment_abort_counter')=1 THEN
          RAISE EXCEPTION USING ERRCODE='40001', MESSAGE='test_payment_confirmed_abort';
        END IF; RETURN NEW; END $$;
        CREATE TRIGGER test_payment_abort BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION test_payment_abort()`);
      let attempts = 0; boundary.before = async () => { attempts++; };
      expect(await recordCashPaymentAction(form())).toEqual({ success: true }); expect(attempts).toBe(2);
      expect(await p.payment.count()).toBe(1); expect(await p.receipt.count()).toBe(1); expect(await p.auditLog.count()).toBe(2);
    });
  }, 60000);
});

describe.skipIf(!enabled)("Phase 3F CLOSED Fund protection", () => {
  it("recording and void leave a fully paid CLOSED Fund and its history unchanged", async () => {
    await fixture(async (p, _other, raw) => {
      expect(await recordCashPaymentAction(form())).toEqual({ success: true });
      const payment = (await p.payment.findFirst())!;
      // Legal fully-paid closure fixture; no financial guard is disabled.
      await raw.query(`UPDATE "Fund" SET status='CLOSED',"closedAt"=now(),"closedByUserId"='chief',"termsVersion"=3 WHERE id='v'`);
      expect(await recordCashPaymentAction(form())).toEqual({ success: false, formError: "This fund is no longer active." });
      expect(await voidPaymentAction(voidForm(payment.id))).toEqual({ success: false, error: "This fund is no longer active." });
      expect(await p.payment.findUnique({ where: { id: payment.id } })).toMatchObject({ status: "ACCEPTED", voidReason: null });
      expect(await p.receipt.findFirst()).toMatchObject({ status: "ACTIVE" }); expect(await p.auditLog.count()).toBe(2);
    });
  }, 60000);
});

describe.skipIf(!enabled)("Phase 3F concurrent duplicate/replacement correction", () => {
  it.each(["initial", "replacement"] as const)("competing %s recordings preserve exactly one accepted Payment", async (kind) => {
    await fixture(async (p, other, raw) => {
      if (kind === "replacement") {
        expect(await recordCashPaymentAction(form())).toEqual({ success: true });
        const old = (await p.payment.findFirst())!;
        expect(await voidPaymentAction(voidForm(old.id))).toEqual({ success: true });
      }
      const written = barrier(), release = barrier(), snapshot = barrier(), committed = barrier();
      let attempts = 0;
      boundary.after = async () => { written.open(); await release.reached; };
      const first = observe(recordCashPaymentAction(form()));
      let second: ReturnType<typeof observe<Awaited<ReturnType<typeof recordCashPaymentAction>>>> | undefined;
      try {
        await reached(written, first);
        await raw.query("BEGIN");
        await expect(raw.query(`SELECT public.vfc_acquire_villages(ARRAY['v']::text[])`)).rejects.toMatchObject({ code: "40001", message: "VFC_SCOPE_BUSY_RETRY_TRANSACTION" });
        await raw.query("ROLLBACK");
        boundary.client = other;
        boundary.before = async (tx) => {
          attempts++;
          if (attempts === 1) { await tx.$queryRaw`SELECT id FROM "Village" WHERE id='v'`; snapshot.open(); await committed.reached; }
        };
        second = observe(recordCashPaymentAction(form()));
        try {
          await reached(snapshot, second); release.open();
          expect(await first).toEqual({ value: { success: true } }); boundary.after = null; committed.open();
          expect(await second).toEqual({ value: { success: false, formError: "A valid payment already exists for this fund and house." } });
          expect(attempts).toBe(2);
          expect(await p.payment.count({ where: { status: "ACCEPTED" } })).toBe(1);
          expect(await p.receipt.count({ where: { status: "ACTIVE" } })).toBe(1);
          expect(await p.payment.count({ where: { status: "VOIDED" } })).toBe(kind === "replacement" ? 1 : 0);
          expect(await p.receipt.count({ where: { status: "VOIDED" } })).toBe(kind === "replacement" ? 1 : 0);
          expect(await p.auditLog.count({ where: { fundId: "v" } })).toBe(kind === "replacement" ? 7 : 2);
        } finally { committed.open(); }
      } finally {
        release.open(); await raw.query("ROLLBACK").catch(console.error);
        await first; await second;
      }
    });
  }, 60000);
});
