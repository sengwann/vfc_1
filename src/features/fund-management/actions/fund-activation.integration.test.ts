/** Authored only. Actual actions/authority/retries/audit/constraints; cookie,
 * preflight, navigation and Prisma connection routing are controlled boundaries. */
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it, vi } from "vitest";
import { disposable, migration } from "../lib/fund-migration-test-support";
import { inspectDatabaseError } from "@/lib/db/database-errors";
const boundary = vi.hoisted(() => ({ client: null as PrismaClient | null,
  before: null as null | ((tx: Prisma.TransactionClient) => Promise<void>),
  after: null as null | (() => Promise<void>) }));
vi.mock("@/lib/authz", () => ({ requireChief: async () => ({ villageId: "v" }) }));
vi.mock("@/lib/auth/session-identity", () => ({ getSessionIdentity: async () => ({ userId: "chief", sessionVersion: 0 }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Object.assign(new Error("navigation"), { path }); } }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get(_target, key) {
  const client = boundary.client!;
  if (key === "$transaction") return (body: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => client.$transaction(async (tx) => {
    await boundary.before?.(tx); const result = await body(tx); await boundary.after?.(); return result;
  }, { ...options, timeout: 15000 });
  const value = Reflect.get(client, key); return typeof value === "function" ? value.bind(client) : value;
} }) }));
import { createFundAction } from "./create-fund.action";
import { updateFundAction } from "./update-fund.action";
import { activateFundAction } from "./activate-fund.action";
const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.VFC_ALLOW_MIGRATION_TESTS === "1";
function gate() { let open!: () => void; const reached = new Promise<void>((resolve) => { open = resolve; }); return { open, reached }; }
function observe<T>(promise: Promise<T>) { return promise.then((value) => ({ value }), (error: unknown) => ({ error })); }
async function reach<T>(barrier: ReturnType<typeof gate>, pending: ReturnType<typeof observe<T>>) {
  await Promise.race([barrier.reached, pending.then((result) => { if ("error" in result) throw result.error; throw new Error("Action ended before barrier"); })]);
}
function form(id = "f", amount = "100001", version = "1") {
  const data = new FormData();
  for (const [key, value] of Object.entries({ fundId: id, termsVersion: version, name: "Fund", totalAmount: amount, targetAmount: amount, startDate: "2026-01-01", endDate: "2027-12-31" })) data.set(key, value);
  return data;
}
async function fixture(run: (p: PrismaClient, other: PrismaClient, raw: import("pg").Client) => Promise<void>) {
  await disposable(async (raw, url) => {
    await raw.query(await migration());
    await raw.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ('v','v','Test',now()),('other','other','Other',now());
      INSERT INTO "User"(id,"villageId",role,"membershipStatus",name,"passwordHash","updatedAt") VALUES ('chief','v','CHIEF','ACTIVE','Chief','unused',now());
      INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") VALUES ('f','v','Fund',100001,'2026-01-01','2027-12-31',now()),('foreign','other','Foreign',1000,'2026-01-01','2027-12-31',now())`);
    const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const other = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    boundary.client = p; boundary.before = null; boundary.after = null;
    let failed = false;
    try { await run(p, other, raw); }
    catch (error) { failed = true; throw error; }
    finally {
      boundary.before = null; boundary.after = null; boundary.client = null;
      const cleanup = await Promise.allSettled([p.$disconnect(), other.$disconnect()]);
      for (const out of cleanup) if (out.status === "rejected") { if (!failed) throw out.reason; console.error("Fund fixture cleanup failed", out.reason); }
    }
  });
}
async function eligible(p: PrismaClient, id: string) {
  await p.$transaction(async (tx) => {
    await tx.house.create({ data: { id, villageId: "v", houseNumber: `H-${id}` } });
    await tx.user.create({ data: { id: `member-${id}`, villageId: "v", houseId: id, name: "Head", passwordHash: "unused", role: "VILLAGER", membershipStatus: "ACTIVE" } });
    await tx.house.update({ where: { id }, data: { headOfHouseId: `member-${id}` } });
  });
}
describe.skipIf(!enabled)("Phase 4 actual Fund actions", () => {
  it.each(["role", "tenant"] as const)("rejects unauthorized draft creation after %s changes despite preflight", async (change) => {
    await fixture(async (p) => {
      await p.user.update({ where: { id: "chief" }, data: change === "role" ? { role: "VILLAGER" } : { villageId: "other" } });
      await expect(createFundAction(form())).rejects.toMatchObject({ path: "/forbidden" });
      expect(await p.fund.count()).toBe(2); expect(await p.auditLog.count()).toBe(0);
    });
  }, 60000);
  it("creates a target-only draft even with zero houses; edits and rejects stale terms", async () => {
    await fixture(async (p) => {
      const out = await createFundAction(form()); if (!out.success) throw new Error("Expected draft creation");
      expect(await p.fund.findUnique({ where: { id: out.fundId } })).toMatchObject({ villageTargetAmount: 100001, status: "DRAFT", eligibleHouseCount: null, assessmentPerHouse: null, snapshotAt: null, termsVersion: 1 });
      expect(await updateFundAction(form(out.fundId, "200001"))).toEqual({ success: true });
      expect(await updateFundAction(form(out.fundId))).toMatchObject({ success: false, formError: "Fund details have changed. Reload the form." });
      expect(await p.auditLog.count({ where: { fundId: out.fundId } })).toBe(2);
      expect(await p.fundHouseAssessment.count()).toBe(0);
    });
  }, 60000);
  it("freezes exactly 100 eligible houses, rounding surplus and audit linkage", async () => {
    await fixture(async (p) => {
      for (let i = 0; i < 100; i++) await eligible(p, `h${i}`);
      await p.house.create({ data: { id: "empty", villageId: "v", houseNumber: "EMPTY" } });
      await eligible(p, "inactive"); await p.house.update({ where: { id: "inactive" }, data: { isActive: false } });
      await p.house.create({ data: { id: "pending", villageId: "v", houseNumber: "PENDING" } });
      await p.user.create({ data: { villageId: "v", houseId: "pending", role: "VILLAGER", membershipStatus: "PENDING", name: "Pending", passwordHash: "unused" } });
      await expect(activateFundAction(form())).rejects.toMatchObject({ path: "/village/funds/f" });
      expect(await p.fund.findUnique({ where: { id: "f" } })).toMatchObject({ status: "ACTIVE", termsVersion: 2, eligibleHouseCount: 100, assessmentPerHouse: 1001 });
      const rows = await p.fundHouseAssessment.findMany({ where: { fundId: "f" } });
      expect(rows).toHaveLength(100); expect(rows.every((r) => r.villageId === "v" && r.assessmentAmount === 1001 && r.houseNumberSnapshot === `H-${r.houseId}`)).toBe(true);
      expect(await p.auditLog.findFirst({ where: { fundId: "f" } })).toMatchObject({ actorUserId: "chief", villageId: "v", entityId: "f", metadata: { event: "FUND_ACTIVATED", eligibleHouseCount: 100, totalAssessment: 100100, roundingSurplus: 99 } });
      await eligible(p, "later");
      await p.user.create({ data: { villageId: "v", houseId: "h0", role: "VILLAGER", membershipStatus: "ACTIVE", name: "Later member", passwordHash: "unused" } });
      expect(await p.fundHouseAssessment.findMany({ where: { fundId: "f" }, orderBy: { id: "asc" } })).toEqual([...rows].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      await expect(activateFundAction(form())).rejects.toMatchObject({ path: expect.stringContaining("Only%20draft") });
      const draft = await createFundAction(form()); if (!draft.success) throw new Error("Expected draft");
      await expect(activateFundAction(form(draft.fundId))).rejects.toMatchObject({ path: expect.stringContaining("active%20fund%20already") });
      expect(await p.fund.count({ where: { villageId: "v", status: "ACTIVE" } })).toBe(1);
    });
  }, 120000);
  it("rejects zero eligibility, excessive assessment and a foreign Fund without snapshots", async () => {
    await fixture(async (p) => {
      await expect(activateFundAction(form())).rejects.toMatchObject({ path: expect.stringContaining("At%20least%20one%20eligible") });
      await eligible(p, "h"); await updateFundAction(form("f", "10000001"));
      await expect(activateFundAction(form("f", "10000001", "2"))).rejects.toMatchObject({ path: expect.stringContaining("Assessment%20must%20not%20exceed") });
      await expect(activateFundAction(form("foreign"))).rejects.toMatchObject({ path: expect.stringContaining("Fund%20not%20found") });
      expect(await p.fundHouseAssessment.count()).toBe(0);
    });
  }, 60000);
  it("activates the exact maximum assessment for a single eligible House", async () => {
    await fixture(async (p) => {
      await eligible(p, "h");
      expect(await updateFundAction(form("f", "10000000"))).toEqual({ success: true });
      await expect(activateFundAction(form("f", "10000000", "2"))).rejects.toMatchObject({ path: "/village/funds/f" });
      expect(await p.fundHouseAssessment.findFirst({ where: { fundId: "f" } })).toMatchObject({ houseId: "h", villageId: "v", assessmentAmount: 10000000 });
    });
  }, 60000);
  it.each(["snapshot", "audit"] as const)("rolls back activation on a specific %s insertion failure", async (stage) => {
    await fixture(async (p, _other, raw) => {
      await eligible(p, "h");
      // A disposable test trigger injects failure; all production guards remain enabled.
      const table = stage === "snapshot" ? "FundHouseAssessment" : "AuditLog";
      await raw.query(`CREATE FUNCTION test_fund_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='TEST_FUND_${stage.toUpperCase()}_FAILURE'; END $$;
        CREATE TRIGGER test_fund_failure BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION test_fund_failure()`);
      const outcome = await observe(activateFundAction(form()));
      if (!("error" in outcome)) throw new Error("Expected injected database failure");
      expect(inspectDatabaseError(outcome.error).sqlStates).toContain("P0001");
      expect(JSON.stringify(outcome.error)).toContain(`TEST_FUND_${stage.toUpperCase()}_FAILURE`);
      expect(await p.fund.findUnique({ where: { id: "f" } })).toMatchObject({ status: "DRAFT", termsVersion: 1, eligibleHouseCount: null, snapshotAt: null });
      expect(await p.fundHouseAssessment.count()).toBe(0); expect(await p.auditLog.count()).toBe(0);
    });
  }, 60000);
  it.each(["role", "session", "tenant"] as const)("rechecks revoked %s after a real stale-snapshot abort", async (change) => {
    await fixture(async (p, _other, raw) => {
      await eligible(p, "h");
      const snapshot = gate(), release = gate(); let attempts = 0;
      boundary.before = async (tx) => { attempts++; if (attempts === 1) { await tx.$queryRaw`SELECT id FROM "Village" WHERE id='v'`; snapshot.open(); await release.reached; } };
      const pending = observe(activateFundAction(form()));
      try {
        await reach(snapshot, pending);
        await raw.query("BEGIN"); await raw.query(`SELECT public.vfc_acquire_villages(ARRAY['other','v']::text[])`);
        await raw.query(change === "role" ? `UPDATE "User" SET role='VILLAGER' WHERE id='chief'` : change === "session" ? `UPDATE "User" SET "sessionVersion"=1 WHERE id='chief'` : `UPDATE "User" SET "villageId"='other' WHERE id='chief'`);
        await raw.query("COMMIT"); release.open();
        expect(await pending).toMatchObject({ error: { path: change === "session" ? "/login" : "/forbidden" } });
        expect(attempts).toBe(2); expect(await p.fundHouseAssessment.count()).toBe(0); expect(await p.auditLog.count()).toBe(0);
      } finally { release.open(); await raw.query("ROLLBACK").catch(console.error); await pending; }
    });
  }, 60000);
  it.each(["same-fund", "different-fund"] as const)("concurrent actual activations (%s) serialize, retry and leave one snapshot", async (kind) => {
    await fixture(async (p, other, raw) => {
      await eligible(p, "h");
      if (kind === "different-fund") await p.fund.create({ data: { id: "second", villageId: "v", name: "Second", villageTargetAmount: 100001, startDate: new Date("2026-01-01"), endDate: new Date("2027-12-31") } });
      const firstWritten = gate(), release = gate(), snapshot = gate(), committed = gate(); let attempts = 0;
      boundary.after = async () => { firstWritten.open(); await release.reached; };
      const first = observe(activateFundAction(form()));
      let second: ReturnType<typeof observe<void>> | undefined;
      try {
        await reach(firstWritten, first);
        await raw.query("BEGIN");
        await expect(raw.query(`SELECT public.vfc_acquire_villages(ARRAY['v']::text[])`)).rejects.toMatchObject({ code: "40001", message: "VFC_SCOPE_BUSY_RETRY_TRANSACTION" });
        await raw.query("ROLLBACK");
        boundary.client = other;
        boundary.before = async (tx) => { attempts++; if (attempts === 1) { await tx.$queryRaw`SELECT id FROM "Village" WHERE id='v'`; snapshot.open(); await committed.reached; } };
        second = observe(activateFundAction(form(kind === "same-fund" ? "f" : "second")));
        try {
          await reach(snapshot, second); release.open();
          expect(await first).toMatchObject({ error: { path: "/village/funds/f" } });
          boundary.after = null; committed.open();
          expect(await second).toMatchObject({ error: { path: expect.stringContaining(kind === "same-fund" ? "Only%20draft" : "active%20fund%20already") } });
          expect(attempts).toBe(2);
          expect(await p.fund.count({ where: { status: "ACTIVE" } })).toBe(1);
          expect(await p.fundHouseAssessment.count()).toBe(1); expect(await p.auditLog.count()).toBe(1);
        } finally { committed.open(); }
      } finally { release.open(); await raw.query("ROLLBACK").catch(console.error); await first; await second; }
    });
  }, 60000);
});
