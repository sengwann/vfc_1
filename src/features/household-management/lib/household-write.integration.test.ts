/** Authored only; runs exclusively in the opt-in disposable PostgreSQL harness. */
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it, vi } from "vitest";
import { disposable, migration } from "@/features/fund-management/lib/fund-migration-test-support";
import { activate } from "@/features/fund-management/lib/fund-schema-test-support";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import { withSerializableRetry } from "@/lib/db/transaction";
import { beginHouseholdWrite, assertHouseNotAssessed } from "./household-write";
import { removeMemberAndDeactivateAssignments } from "./remove-member-transaction";
import { getCurrentPeriod } from "@/lib/authz/collector-period";
vi.mock("@/lib/auth/session-identity", () => ({ getSessionIdentity: vi.fn() }));
// Only request/session/navigation boundaries are mocked; action callbacks,
// authority checks, SQL locking, retry classification and audits remain real.
const actionDb = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  hook: null as ((tx: Prisma.TransactionClient, body: () => Promise<unknown>) => Promise<unknown>) | null,
}));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, {
  get(_target, key) {
    const client = actionDb.client!;
    if (key === "$transaction") return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number; maxWait?: number }) =>
      client.$transaction((tx) => actionDb.hook ? actionDb.hook(tx, () => callback(tx)) : callback(tx), { ...options, timeout: 15000 });
    const value = Reflect.get(client, key);
    return typeof value === "function" ? value.bind(client) : value;
  },
}) }));
const chiefContext = () => ({ user: { id: "actor" }, villageId: "v" });
vi.mock("@/lib/authz", () => ({ requireChief: () => chiefContext() }));
vi.mock("@/lib/authz/roles", () => ({ requireChief: () => chiefContext() }));
vi.mock("./household-access", () => ({ requireHouseholdManagementAccess: async () => ({ user: { id: "actor" }, house: { id: "v", villageId: "v", isActive: true, headOfHouseId: "actor" } }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`TEST_REDIRECT:${path}`); }, notFound: () => { throw new Error("TEST_NOT_FOUND"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/shell/lib/shell-revalidation", () => ({ revalidateVillageShell: vi.fn() }));
import { approveMemberAction } from "../actions/approve-member.action";
import { removeMemberAction } from "../actions/remove-member.action";
import { changeHeadAction } from "../actions/change-head.action";
import { chiefApproveFirstMemberAction } from "../actions/chief-approve-first-member.action";
import { deactivateHouseAction } from "@/features/house-management/actions/deactivate-house.action";
function form(values: Record<string, string>) { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }
function operate(operation: string) {
  if (operation === "approval") return approveMemberAction(form({ memberId: "member" }));
  if (operation === "removal") return removeMemberAction(form({ memberId: "member" }));
  if (operation === "head replacement") return changeHeadAction(form({ targetUserId: "member" }));
  return deactivateHouseAction("v"); // Chief permission, unlike household Head operations.
}
function settled(operation: Promise<unknown>) { return operation.then(() => undefined, (error: unknown) => error); }
const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.VFC_ALLOW_MIGRATION_TESTS === "1";
function barrier() { let open!: () => void; const reached = new Promise<void>((r) => { open = r; }); return { open, reached }; }
/** Owns the background operation from startup through settlement, on every path. */
async function concurrent(
  raw: import("pg").Client,
  releases: Array<() => void>,
  start: () => Promise<unknown>,
  run: (result: Promise<unknown>) => Promise<void>,
) {
  let result: Promise<unknown> | undefined;
  let failed = false;
  try {
    result = settled(start());
    await run(result);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    for (const release of releases) release();
    const cleanupErrors: unknown[] = [];
    // Release any raw locks before awaiting an action that may need them.
    try { await raw.query("ROLLBACK"); } catch (error) { cleanupErrors.push(error); }
    if (result) {
      // settled() observes rejection immediately, including navigation signals.
      // Await completion before the fixture clears the proxy or disconnects.
      try { await result; } catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length) {
      if (!failed) throw cleanupErrors[0];
      console.error("Concurrent test cleanup failed; preserving original failure", cleanupErrors);
    }
  }
}
async function fixture(run: (p: PrismaClient, raw: import("pg").Client) => Promise<void>) {
  const failures: { original?: { error: unknown } } = {};
  try {
    await disposable(async (raw, url) => {
      await raw.query(await migration());
      await raw.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ('v','v','Village',now()),('other','other','Other',now())`);
      await raw.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ('v','v','H1',now())`);
      await raw.query(`INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt") VALUES
        ('actor','v','v','CHIEF','ACTIVE','Head','unused',now()),('member','v','v','VILLAGER','ACTIVE','Member','unused',now())`);
      await raw.query(`UPDATE "House" SET "headOfHouseId"='actor' WHERE id='v'`);
      await raw.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") VALUES
        ('v','v','Fund',1001,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date-1,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date+1,now())`);
      const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      vi.mocked(getSessionIdentity).mockResolvedValue({ userId: "actor", sessionVersion: 0 });
      actionDb.client = p; actionDb.hook = null;
      try {
        await run(p, raw);
      } catch (error) {
        failures.original = { error };
        throw error;
      } finally {
        actionDb.hook = null; actionDb.client = null;
        try { await p.$disconnect(); } catch (error) {
          if (!failures.original) { failures.original = { error }; throw error; }
          console.error("Prisma disconnect failed; preserving original failure", error);
        }
      }
    });
  } catch (error) {
    // The shared disposable harness may itself fail during DB cleanup. Keep
    // this test's original assertion/operation failure as the reported error.
    if (failures.original) {
      if (error !== failures.original.error) console.error("Disposable cleanup failed; preserving original failure", error);
      throw failures.original.error;
    }
    throw error;
  }
}
describe.skipIf(!enabled)("Phase 3C scoped household writes", () => {
  it.each(["approval", "removal", "deactivation", "head replacement"] as const)("retries a complete %s transaction racing activation", async (operation) => {
    await fixture(async (p, raw) => {
      if (operation === "approval") await raw.query(`UPDATE "User" SET "membershipStatus"='PENDING' WHERE id='member'`);
      const snapshot = barrier(); const activated = barrier(); let attempts = 0;
      actionDb.hook = async (tx, body) => {
        attempts += 1;
        if (attempts === 1) { await tx.$queryRaw`SELECT id FROM "Village" WHERE id='v'`; snapshot.open(); await activated.reached; }
        return body();
      };
      await concurrent(raw, [activated.open], () => operate(operation), async (result) => {
        await Promise.race([snapshot.reached, result.then((error) => { throw error ?? new Error("Action ended before snapshot barrier"); })]);
        await raw.query("BEGIN"); await raw.query(`SELECT vfc_acquire_villages(ARRAY['v']::text[])`); await activate(raw, "v"); await raw.query("COMMIT");
        activated.open();
        const outcome = await result;
        expect(outcome).toMatchObject({ message: `TEST_REDIRECT:${operation === "deactivation" ? "/village/houses/v" : "/village/household"}` });
        expect(await p.user.findUnique({ where: { id: "member" } })).toMatchObject({ membershipStatus: operation === "removal" ? "REMOVED" : "ACTIVE" });
        expect(await p.house.findUnique({ where: { id: "v" } })).toMatchObject({ isActive: true, headOfHouseId: operation === "head replacement" ? "member" : "actor" });
        expect(attempts).toBe(2);
        expect(await p.fundHouseAssessment.count({ where: { fundId: "v" } })).toBe(1);
        expect(await p.fund.findUnique({ where: { id: "v" } })).toMatchObject({ assessmentPerHouse: 1001, eligibleHouseCount: 1 });
      });
    });
  }, 60000);
  it("rejects last Head removal and cross-Village identity", async () => {
    await fixture(async (p) => {
      await expect(p.$transaction(async (tx) => {
        await beginHouseholdWrite(tx, { villageId: "v", permission: "head", actorUserId: "actor", houseIds: ["v"] });
        await removeMemberAndDeactivateAssignments(tx, { actorUserId: "actor", targetUserId: "actor", villageId: "v", houseId: "v", currentPeriod: getCurrentPeriod() });
      })).rejects.toThrow("REMOVE_MEMBER_TARGET_NOT_REMOVABLE");
      await expect(p.$transaction((tx) => beginHouseholdWrite(tx, { villageId: "other", permission: "chief", actorUserId: "actor" }))).rejects.toMatchObject({ code: "VFC_AUTH_VILLAGE" });
      expect(await p.user.findUnique({ where: { id: "actor" } })).toMatchObject({ membershipStatus: "ACTIVE" });
    });
  }, 60000);
  it("atomically removes an ordinary member and deactivates current assignments", async () => {
    await fixture(async (p) => {
      const { year, month } = getCurrentPeriod();
      await p.collectorAssignment.create({ data: { id: "assignment", userId: "member", villageId: "v", year, month } });
      await p.$transaction(async (tx) => {
        await beginHouseholdWrite(tx, { villageId: "v", permission: "head", actorUserId: "actor", houseIds: ["v"], targetUserIds: ["member"], deactivateAssignmentsFor: "member" });
        await removeMemberAndDeactivateAssignments(tx, { actorUserId: "actor", targetUserId: "member", villageId: "v", houseId: "v", currentPeriod: { year, month } });
      });
      expect(await p.user.findUnique({ where: { id: "member" } })).toMatchObject({ membershipStatus: "REMOVED" });
      expect(await p.collectorAssignment.findUnique({ where: { id: "assignment" } })).toMatchObject({ isActive: false });
    });
  }, 60000);
  it("rejects deactivation of an assessed House after payment", async () => {
    await fixture(async (p, raw) => {
      await raw.query("BEGIN"); await activate(raw, "v"); await raw.query("COMMIT");
      await p.$transaction(async (tx) => {
        await beginHouseholdWrite(tx, { villageId: "v", permission: "chief", actorUserId: "actor", houseIds: ["v"] });
        await tx.payment.create({ data: { id: "paid", villageId: "v", fundId: "v", houseId: "v", fundHouseAssessmentId: "v", payerUserId: "actor", collectorUserId: "actor", amount: 1001 } });
        await tx.receipt.create({ data: { paymentId: "paid", villageId: "v", receiptNumber: "R1" } });
      });
      await expect(p.$transaction(async (tx) => {
        await beginHouseholdWrite(tx, { villageId: "v", permission: "chief", actorUserId: "actor", houseIds: ["v"] });
        await assertHouseNotAssessed(tx, "v", "v");
      })).rejects.toThrow("HOUSE_ACTIVE_FUND_ASSESSMENT");
      expect(await p.house.findUnique({ where: { id: "v" } })).toMatchObject({ isActive: true });
    });
  }, 60000);
  it("rolls back an invalid Head replacement under an active Fund", async () => {
    await fixture(async (p, raw) => {
      await raw.query(`UPDATE "User" SET "membershipStatus"='PENDING' WHERE id='member'`);
      await raw.query("BEGIN"); await activate(raw, "v"); await raw.query("COMMIT");
      const error = await p.$transaction(async (tx) => {
        await beginHouseholdWrite(tx, { villageId: "v", permission: "head", actorUserId: "actor", houseIds: ["v"], targetUserIds: ["member"] });
        await tx.house.update({ where: { id: "v" }, data: { headOfHouseId: "member" } });
      }).then(() => undefined, (failure: unknown) => failure);
      expect(String(error)).toContain("VFC_ACTIVE_HOUSE_HEAD_PROTECTED");
      expect(await p.house.findUnique({ where: { id: "v" } })).toMatchObject({ headOfHouseId: "actor" });
    });
  }, 60000);
  it("allows a new first-member/Head transition without extending the frozen snapshot", async () => {
    await fixture(async (p, raw) => {
      await raw.query("BEGIN"); await activate(raw, "v"); await raw.query("COMMIT");
      await p.$transaction(async (tx) => {
        await beginHouseholdWrite(tx, { villageId: "v", permission: "chief", actorUserId: "actor" });
        await tx.house.create({ data: { id: "new", villageId: "v", houseNumber: "H2" } });
        await tx.user.create({ data: { id: "new-member", villageId: "v", houseId: "new", role: "VILLAGER", membershipStatus: "PENDING", name: "New", passwordHash: "unused" } });
      });
      await expect(chiefApproveFirstMemberAction(form({ houseId: "new", memberId: "new-member" }))).rejects.toThrow("TEST_REDIRECT:/village/houses/new");
      expect(await p.user.findUnique({ where: { id: "new-member" } })).toMatchObject({ membershipStatus: "ACTIVE" });
      expect(await p.house.findUnique({ where: { id: "new" } })).toMatchObject({ headOfHouseId: "new-member" });
      expect(await p.fundHouseAssessment.findMany({ where: { fundId: "v" }, select: { houseId: true } })).toEqual([{ houseId: "v" }]);
    });
  }, 60000);

  it.each(["approval", "removal", "deactivation", "head replacement"] as const)("commits %s before competing activation", async (operation) => {
    await fixture(async (p, raw) => {
      if (operation === "approval") await raw.query(`UPDATE "User" SET "membershipStatus"='PENDING' WHERE id='member'`);
      // Deactivation needs an empty House to satisfy the pre-existing member rule.
      if (operation === "deactivation") await raw.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ('empty','v','EMPTY',now())`);
      const written = barrier(); const release = barrier();
      actionDb.hook = async (_tx, body) => { const value = await body(); written.open(); await release.reached; return value; };
      await concurrent(raw, [release.open],
        () => operation === "deactivation" ? deactivateHouseAction("empty") : operate(operation),
        async (result) => {
          await Promise.race([written.reached, result.then((error) => { throw error ?? new Error("Action ended before write barrier"); })]);
          // Keep the household action holding its scope until the competing
          // transaction has actually received the approved NOWAIT diagnostic.
          await raw.query("BEGIN");
          await expect(raw.query(`SELECT vfc_acquire_villages(ARRAY['v']::text[])`)).rejects.toMatchObject({
            code: "40001", message: "VFC_SCOPE_BUSY_RETRY_TRANSACTION",
          });
          await raw.query("ROLLBACK");
          release.open();
          expect(await result).toMatchObject({ message: `TEST_REDIRECT:${operation === "deactivation" ? "/village/houses/empty" : "/village/household"}` });
          // The failed activation transaction is never reused.
          await raw.query("BEGIN");
          await raw.query(`SELECT vfc_acquire_villages(ARRAY['v']::text[])`);
          await activate(raw, "v");
          await raw.query("COMMIT");
          expect(await p.user.findUnique({ where: { id: "member" } })).toMatchObject({ membershipStatus: operation === "removal" ? "REMOVED" : "ACTIVE" });
          expect(await p.house.findUnique({ where: { id: "v" } })).toMatchObject({ headOfHouseId: operation === "head replacement" ? "member" : "actor" });
          if (operation === "deactivation") expect(await p.house.findUnique({ where: { id: "empty" } })).toMatchObject({ isActive: false });
          expect(await p.fundHouseAssessment.findMany({ where: { fundId: "v" }, select: { houseId: true } })).toEqual([{ houseId: "v" }]);
          expect(await p.fund.findUnique({ where: { id: "v" } })).toMatchObject({ status: "ACTIVE", eligibleHouseCount: 1, assessmentPerHouse: 1001 });
        });
    });
  }, 60000);

  it("rechecks revoked Chief authority on a complete retry", async () => {
    await fixture(async (p, raw) => {
      await raw.query('CREATE TABLE retry_probe (id integer PRIMARY KEY, revision integer NOT NULL)');
      await raw.query('INSERT INTO retry_probe VALUES (1,0)');
      const authorized = barrier(); const changed = barrier(); const retryStarted = barrier(); const revoked = barrier(); let attempts = 0;
      await concurrent(raw, [changed.open, revoked.open],
        () => withSerializableRetry(() => p.$transaction(async (tx) => {
          attempts += 1;
          if (attempts === 2) { retryStarted.open(); await revoked.reached; }
          await beginHouseholdWrite(tx, { villageId: "v", permission: "chief", actorUserId: "actor" });
          if (attempts === 1) {
            await tx.$queryRaw`SELECT revision FROM retry_probe WHERE id=1`;
            authorized.open(); await changed.reached;
            // A concurrent committed update of this test-only row produces a
            // genuine PostgreSQL 40001 after authority was successfully checked.
            await tx.$executeRaw`UPDATE retry_probe SET revision=revision+1 WHERE id=1`;
          }
          await tx.house.update({ where: { id: "v" }, data: { houseNumber: "UNAUTHORIZED" } });
        }, { isolationLevel: "Serializable", timeout: 15000 })), async (result) => {
        await Promise.race([authorized.reached, result.then((error) => { throw error ?? new Error("Transaction ended before authorization barrier"); })]);
        await raw.query('UPDATE retry_probe SET revision=revision+1 WHERE id=1');
        changed.open();
        await Promise.race([retryStarted.reached, result.then((error) => { throw error ?? new Error("Transaction ended before retry barrier"); })]); // First attempt has rolled back its locks.
        await raw.query("BEGIN"); await raw.query(`SELECT vfc_acquire_villages(ARRAY['v']::text[])`);
        await raw.query(`UPDATE "User" SET role='VILLAGER' WHERE id='actor'`); await raw.query("COMMIT");
        revoked.open();
        expect(await result).toMatchObject({ code: "VFC_AUTH_ROLE" });
        expect(attempts).toBe(2);
        expect(await p.house.findUnique({ where: { id: "v" } })).toMatchObject({ houseNumber: "H1" });
        expect(await p.auditLog.count()).toBe(0);
      });
    });
  }, 60000);

  it("rolls back a claimed first Head when conditional member activation fails", async () => {
    await fixture(async (p, raw) => {
      await raw.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ('new','v','H2',now())`);
      await raw.query(`INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt") VALUES ('new-member','v','new','VILLAGER','PENDING','New','unused',now())`);
      let observedClaim = false; let failure: unknown;
      actionDb.hook = async (tx, body) => {
        // A separate connection commits a rejection after successful action
        // preflight, before the callback establishes its snapshot/locks.
        await raw.query(`UPDATE "User" SET "membershipStatus"='REJECTED' WHERE id='new-member'`);
        // The real action then claims Head before its conditional update fails.
        try { return await body(); } catch (error) {
          failure = error;
          observedClaim = (await tx.house.findUnique({ where: { id: "new" } }))?.headOfHouseId === "new-member";
          throw error;
        }
      };
      await expect(chiefApproveFirstMemberAction(form({ houseId: "new", memberId: "new-member" }))).rejects.toThrow("TEST_REDIRECT:/village/houses/new");
      expect(failure).toMatchObject({ message: "INVALID_MEMBERSHIP_STATE" });
      expect(observedClaim).toBe(true);
      expect(await p.house.findUnique({ where: { id: "new" } })).toMatchObject({ headOfHouseId: null });
      expect(await p.user.findUnique({ where: { id: "new-member" } })).toMatchObject({ membershipStatus: "REJECTED" });
      expect(await p.auditLog.count({ where: { entityId: "new-member" } })).toBe(0);
    });
  }, 60000);

});
