/** Actual actions/domain calculations/retry; DB, authority and audit are unit boundaries. */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), authority: vi.fn(), scope: vi.fn(), audit: vi.fn(),
  tx: { fund: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findFirstOrThrow: vi.fn() },
    house: { findMany: vi.fn() }, fundHouseAssessment: { createMany: vi.fn() }, $queryRaw: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/authz", () => ({ requireChief: async () => ({ villageId: "v" }) }));
vi.mock("@/lib/authz/transaction-authority", async (original) => ({
  ...await original<typeof import("@/lib/authz/transaction-authority")>(), authorizeFinancialTransaction: mocks.authority,
}));
vi.mock("@/lib/db/village-scope", async (original) => ({
  ...await original<typeof import("@/lib/db/village-scope")>(), acquireVillageScopes: mocks.scope,
}));
vi.mock("@/lib/audit/financial-audit", () => ({ createFinancialAudit: mocks.audit }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Object.assign(new Error("navigation"), { path }); } }));
import { TransactionAuthorityError } from "@/lib/authz/transaction-authority";
import { FinancialLockNotFoundError } from "@/lib/db/financial-locks";
import { createFundAction } from "./create-fund.action";
import { updateFundAction } from "./update-fund.action";
import { activateFundAction } from "./activate-fund.action";
function form(amount = "100001") {
  const data = new FormData();
  for (const [key, value] of Object.entries({ fundId: "f", termsVersion: "1", name: "Fund", totalAmount: amount, targetAmount: amount, startDate: "2026-01-01", endDate: "2026-12-31" })) data.set(key, value);
  return data;
}
function houses(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `h${i}`, houseNumber: `H${i}` }));
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((body: (tx: typeof mocks.tx) => Promise<unknown>) => body(mocks.tx));
  mocks.authority.mockResolvedValue({ actor: { id: "chief" }, funds: [{ id: "f", status: "DRAFT", termsVersion: 1 }] });
  mocks.tx.fund.create.mockResolvedValue({ id: "f", villageTargetAmount: 100001, termsVersion: 1 });
  mocks.tx.fund.update.mockResolvedValue({ id: "f", villageTargetAmount: 100001, termsVersion: 2 });
  mocks.tx.fund.findMany.mockResolvedValue([]);
  mocks.tx.fund.findFirstOrThrow.mockResolvedValue({ id: "f", villageTargetAmount: 100001 });
  mocks.tx.house.findMany.mockResolvedValue(houses(100));
  mocks.tx.$queryRaw.mockResolvedValue([{ now: new Date("2026-11-09T00:00:00Z") }]);
});
describe("Phase 4 draft actions", () => {
  it("stores the village target unchanged with no premature eligibility calculation", async () => {
    expect(await createFundAction(form())).toEqual({ success: true, fundId: "f" });
    expect(mocks.tx.fund.create).toHaveBeenCalledWith({ data: expect.objectContaining({ villageId: "v", villageTargetAmount: 100001, status: "DRAFT" }) });
    expect(mocks.tx.house.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.fundHouseAssessment.createMany).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ event: "DRAFT_CREATED", actorUserId: "chief", fundId: "f", villageId: "v" }));
  });
  it.each(["", "0", "-1", "1.5", "1000000001", "9007199254740992"])("rejects invalid target %s before transaction", async (amount) => {
    expect(await createFundAction(form(amount))).toMatchObject({ success: false });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("updates only draft terms and increments their submitted version", async () => {
    expect(await updateFundAction(form())).toEqual({ success: true });
    expect(mocks.tx.fund.update).toHaveBeenCalledWith({ where: { id: "f" }, data: expect.objectContaining({ villageTargetAmount: 100001, termsVersion: { increment: 1 } }) });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ event: "DRAFT_UPDATED" }));
  });
  it("rejects a stale draft without writes", async () => {
    const data = form(); data.set("termsVersion", "2");
    expect(await updateFundAction(data)).toMatchObject({ success: false, formError: "Fund details have changed. Reload the form." });
    expect(mocks.tx.fund.update).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(["VFC_AUTH_ROLE", "VFC_AUTH_VILLAGE", "VFC_AUTH_SESSION", "VFC_AUTH_PASSWORD_CHANGE"] as const)("maps permanent %s without retry or writes", async (code) => {
    mocks.authority.mockRejectedValue(new TransactionAuthorityError(code));
    await expect(createFundAction(form())).rejects.toMatchObject({ path: code === "VFC_AUTH_SESSION" ? "/login" : code === "VFC_AUTH_PASSWORD_CHANGE" ? "/change-password" : "/forbidden" });
    expect(mocks.transaction).toHaveBeenCalledTimes(1); expect(mocks.tx.fund.create).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
});
describe("Phase 4 activation action", () => {
  it.each([[100001, 100, 1001, 100100, 99], [100000, 100, 1000, 100000, 0], [10000000, 1, 10000000, 10000000, 0]])("freezes target %i for %i eligible houses", async (target, count, amount, total, surplus) => {
    mocks.tx.fund.findFirstOrThrow.mockResolvedValue({ id: "f", villageTargetAmount: target });
    mocks.tx.house.findMany.mockResolvedValue(houses(count));
    await expect(activateFundAction(form())).rejects.toMatchObject({ path: "/village/funds/f" });
    const rows = mocks.tx.fundHouseAssessment.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(count);
    expect(rows[0]).toEqual({ fundId: "f", villageId: "v", houseId: "h0", houseNumberSnapshot: "H0", assessmentAmount: amount });
    expect(mocks.audit).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ event: "FUND_ACTIVATED", metadata: expect.objectContaining({ eligibleHouseCount: count, assessmentPerHouse: amount, totalAssessment: total, roundingSurplus: surplus }) }));
    expect(mocks.tx.house.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { villageId: "v", isActive: true, members: { some: { villageId: "v", membershipStatus: "ACTIVE" } } } }));
    expect(mocks.scope.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.house.findMany.mock.invocationCallOrder[0]);
    expect(mocks.tx.fundHouseAssessment.createMany.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.fund.update.mock.invocationCallOrder[0]);
  });
  it.each([[0, 100001], [1, 10000001]])("rejects invalid assessment for %i houses and target %i", async (count, target) => {
    mocks.tx.house.findMany.mockResolvedValue(houses(count));
    mocks.tx.fund.findFirstOrThrow.mockResolvedValue({ id: "f", villageTargetAmount: target });
    await expect(activateFundAction(form())).rejects.toMatchObject({ path: expect.stringContaining("activationError=") });
    expect(mocks.tx.fundHouseAssessment.createMany).not.toHaveBeenCalled(); expect(mocks.tx.fund.update).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(["ACTIVE", "CLOSED"])("rejects %s Fund activation", async (status) => {
    mocks.authority.mockResolvedValue({ actor: { id: "chief" }, funds: [{ id: "f", status, termsVersion: 1 }] });
    await expect(activateFundAction(form())).rejects.toMatchObject({ path: expect.stringContaining("activationError=") });
    expect(mocks.tx.fundHouseAssessment.createMany).not.toHaveBeenCalled();
  });
  it("rejects stale activation terms before any snapshot or audit", async () => {
    const data = form(); data.set("termsVersion", "2");
    await expect(activateFundAction(data)).rejects.toMatchObject({ path: expect.stringContaining("Fund%20details%20have%20changed") });
    expect(mocks.tx.fundHouseAssessment.createMany).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("rejects another ACTIVE fund and cross-tenant targets", async () => {
    mocks.tx.fund.findMany.mockResolvedValue([{ id: "other" }]);
    await expect(activateFundAction(form())).rejects.toMatchObject({ path: expect.stringContaining("active%20fund%20already") });
    expect(mocks.authority).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ fundIds: ["f", "other"] }));
    mocks.authority.mockRejectedValue(new FinancialLockNotFoundError());
    await expect(activateFundAction(form())).rejects.toMatchObject({ path: expect.stringContaining("Fund%20not%20found") });
    expect(mocks.tx.fundHouseAssessment.createMany).not.toHaveBeenCalled();
  });
  it("propagates snapshot/audit failures without converting them to success", async () => {
    const failure = { code: "23503", constraint: "AuditLog_actorUserId_fkey" };
    mocks.audit.mockRejectedValue(failure);
    await expect(activateFundAction(form())).rejects.toBe(failure);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
});
