/** Real action, mocked identity and Prisma. No database behavior is claimed. */
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  currentUser: vi.fn(), identity: vi.fn(), collector: vi.fn(), period: vi.fn(),
  transaction: vi.fn(), readOnly: vi.fn(), actor: vi.fn(), assignment: vi.fn(), fund: vi.fn(), houses: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: m.currentUser, getSessionIdentity: m.identity }));
vi.mock("@/lib/authz", () => ({ getActiveCollectorContext: m.collector, getCurrentPeriod: m.period }));
import { searchPaymentStatusAction } from "./search-payment-status.action";
import { FundReportIntegrityError } from "../lib/fund-report-queries";
const actor = () => ({
  role: "CHIEF", villageId: "v", membershipStatus: "ACTIVE", mustChangePassword: false,
  sessionVersion: 2, village: { status: "ACTIVE" },
});
function form(fundId = "f") {
  const input = new FormData();
  input.set("fundId", fundId); input.set("q", "H");
  input.set("villageId", "attacker-village"); input.set("userId", "attacker");
  return input;
}
beforeEach(() => {
  vi.resetAllMocks();
  m.currentUser.mockResolvedValue({ ...actor(), id: "chief" });
  m.identity.mockResolvedValue({ userId: "chief", sessionVersion: 2 });
  m.actor.mockResolvedValue(actor());
  m.collector.mockResolvedValue(null);
  m.period.mockReturnValue({ year: 2026, month: 11 });
  m.assignment.mockResolvedValue({ id: "assignment" });
  m.fund.mockResolvedValue({ id: "f", status: "ACTIVE" });
  m.houses.mockResolvedValue([
    { id: "new", houseNumber: "H-new", headOfHouse: null, assessments: [] },
    { id: "unpaid", houseNumber: "H-unpaid", headOfHouse: null, assessments: [{ id: "a", payments: [] }] },
    { id: "paid", houseNumber: "H-paid", headOfHouse: { name: "Head" }, assessments: [{ id: "b", payments: [{ id: "accepted-replacement" }] }] },
  ]);
  m.transaction.mockImplementation(async (body) => body({
    $executeRaw: m.readOnly, user: { findUnique: m.actor },
    collectorAssignment: { findFirst: m.assignment }, fund: { findFirst: m.fund }, house: { findMany: m.houses },
  }));
});

describe("frozen-assessment payment-status search", () => {
  it("distinguishes not-assessed, unpaid and paid; ignores submitted identity/scope", async () => {
    const result = await searchPaymentStatusAction(form());
    expect(result).toEqual({ ok: true, results: [
      { id: "new", houseNumber: "H-new", headName: null, status: "NOT_ASSESSED" },
      { id: "unpaid", houseNumber: "H-unpaid", headName: null, status: "UNPAID" },
      { id: "paid", houseNumber: "H-paid", headName: "Head", status: "PAID" },
    ] });
    expect(m.fund.mock.calls[0][0].where).toEqual({ id: "f", villageId: "v" });
    const query = m.houses.mock.calls[0][0];
    expect(query.where.villageId).toBe("v");
    expect(query.select.assessments.where).toEqual({ fundId: "f", villageId: "v" });
    expect(query.select.assessments.select.payments.where).toEqual({ fundId: "f", villageId: "v", status: "ACCEPTED" });
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", maxWait: 2000, timeout: 5000 });
    expect(m.readOnly.mock.invocationCallOrder[0]).toBeLessThan(m.actor.mock.invocationCallOrder[0]);
  });
  it("preserves active collector access and rechecks the current assignment", async () => {
    m.currentUser.mockResolvedValue({ ...actor(), role: "VILLAGER", id: "collector" });
    m.identity.mockResolvedValue({ userId: "collector", sessionVersion: 2 });
    m.actor.mockResolvedValue({ ...actor(), role: "VILLAGER" });
    m.collector.mockResolvedValue({ assignment: { id: "assignment" } });
    expect((await searchPaymentStatusAction(form())).ok).toBe(true);
    expect(m.assignment.mock.calls[0][0].where).toEqual({ userId: "collector", villageId: "v", year: 2026, month: 11, isActive: true });
    m.assignment.mockResolvedValue(null);
    m.houses.mockClear();
    expect(await searchPaymentStatusAction(form())).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(m.houses).not.toHaveBeenCalled();
  });
  it("rejects a non-collector Villager before a report transaction", async () => {
    m.currentUser.mockResolvedValue({ ...actor(), id: "member", role: "VILLAGER" });
    expect(await searchPaymentStatusAction(form())).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("returns the same error for foreign and missing funds", async () => {
    m.fund.mockResolvedValue(null);
    expect(await searchPaymentStatusAction(form("foreign"))).toEqual({ ok: false, code: "FUND_NOT_FOUND" });
    expect(await searchPaymentStatusAction(form("missing"))).toEqual({ ok: false, code: "FUND_NOT_FOUND" });
    expect(m.houses).not.toHaveBeenCalled();
  });
  it.each([
    [{ sessionVersion: 3 }, "SIGNED_OUT"], [{ mustChangePassword: true }, "PASSWORD_CHANGE"],
    [{ villageId: "other" }, "FORBIDDEN"], [{ membershipStatus: "PENDING" }, "FORBIDDEN"],
    [{ village: { status: "SUSPENDED" } }, "FORBIDDEN"],
  ] as const)("denies a changed actor before reading the fund: %j", async (change, code) => {
    m.actor.mockResolvedValue({ ...actor(), ...change });
    expect(await searchPaymentStatusAction(form())).toEqual({ ok: false, code });
    expect(m.fund).not.toHaveBeenCalled();
  });
  it("rejects a signed-out user", async () => {
    m.currentUser.mockResolvedValue(null);
    expect(await searchPaymentStatusAction(form())).toEqual({ ok: false, code: "SIGNED_OUT" });
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("shows draft search matches as not assessed", async () => {
    m.fund.mockResolvedValue({ id: "f", status: "DRAFT" });
    m.houses.mockResolvedValue([{ id: "h", houseNumber: "H", headOfHouse: null, assessments: [] }]);
    expect(await searchPaymentStatusAction(form())).toEqual({ ok: true, results: [
      { id: "h", houseNumber: "H", headName: null, status: "NOT_ASSESSED" },
    ] });
  });
  it("rejects duplicate accepted coverage rather than hiding it with take: 1", async () => {
    m.houses.mockResolvedValue([{ id: "h", houseNumber: "H", headOfHouse: null,
      assessments: [{ id: "a", payments: [{ id: "p" }, { id: "q" }] }],
    }]);
    await expect(searchPaymentStatusAction(form())).rejects.toBeInstanceOf(FundReportIntegrityError);
  });
  it("propagates unexpected database failures", async () => {
    m.houses.mockRejectedValue(new Error("database failed"));
    await expect(searchPaymentStatusAction(form())).rejects.toThrow("database failed");
  });
});
