import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  authority: vi.fn(), audit: vi.fn(), allocator: vi.fn(),
  tx: { fund: { findFirst: vi.fn() }, fundHouseAssessment: { findFirst: vi.fn() }, user: { findFirst: vi.fn() }, payment: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() }, receipt: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() }, $queryRaw: vi.fn() },
  transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/authz", () => ({ requireActiveCollector: async () => ({ villageId: "v" }) }));
vi.mock("@/lib/authz/transaction-authority", async (original) => ({ ...await original<typeof import("@/lib/authz/transaction-authority")>(), authorizeFinancialTransaction: mocks.authority }));
vi.mock("@/lib/audit/financial-audit", () => ({ createFinancialAudit: mocks.audit }));
vi.mock("@/lib/receipts/receipt-number", () => ({ generateReceiptNumber: mocks.allocator }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Object.assign(new Error(path), { path }); } }));
import { TransactionAuthorityError } from "@/lib/authz/transaction-authority";
import { recordCashPaymentAction } from "./record-cash-payment.action";
import { voidPaymentAction } from "./void-payment.action";
function form(input: Record<string, string> = {}) {
  const result = new FormData();
  for (const [k, v] of Object.entries({ fundId: "f", termsVersion: "2", houseId: "h", payerUserId: "payer", amount: "1001", paymentId: "p", voidReason: "Wrong payer selected", ...input })) result.set(k, v);
  return result;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.transaction.mockImplementation((callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx));
  mocks.authority.mockResolvedValue({ actor: { id: "collector" }, funds: [{ id: "f", status: "ACTIVE", termsVersion: 2 }], houses: [{ id: "h", isActive: true }] });
  mocks.tx.$queryRaw.mockResolvedValue([{ open: true }]);
  mocks.tx.fund.findFirst.mockResolvedValue({ id: "f", villageId: "v", status: "ACTIVE", termsVersion: 2 });
  mocks.tx.fundHouseAssessment.findFirst.mockResolvedValue({ id: "a", assessmentAmount: 1001 });
  mocks.tx.user.findFirst.mockResolvedValue({ id: "payer" });
  mocks.tx.payment.findFirst.mockResolvedValue(null);
  mocks.tx.payment.create.mockResolvedValue({ id: "p" }); mocks.tx.receipt.create.mockResolvedValue({ id: "r" });
  mocks.tx.receipt.findFirst.mockResolvedValue({ id: "r" }); mocks.allocator.mockResolvedValue("TEST-1");
});
describe("Phase 3F payment action boundaries (transaction authority mocked; validators and retries real)", () => {
  it.each(["", "0", "1.1", "9007199254740992"])("rejects malformed submitted terms %s before transaction", async (termsVersion) => {
    expect(await recordCashPaymentAction(form({ termsVersion }))).toMatchObject({ success: false }); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("requires a submitted Fund identity", async () => {
    const data = form(); data.delete("fundId"); expect(await recordCashPaymentAction(data)).toMatchObject({ success: false }); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it.each(["1000", "10000001", "0", "-1", "1.5", "9007199254740992"])("rejects invalid MMK %s without writes", async (amount) => {
    expect(await recordCashPaymentAction(form({ amount }))).toMatchObject({ success: false, fieldErrors: { amount: expect.any(String) } });
    expect(mocks.tx.payment.create).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(["1001", "2000", "10000000"])("accepts %s against the frozen assessment", async (amount) => {
    expect(await recordCashPaymentAction(form({ amount }))).toEqual({ success: true });
    expect(mocks.tx.payment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ fundId: "f", villageId: "v", houseId: "h", fundHouseAssessmentId: "a", amount: Number(amount), collectorUserId: "collector" }) });
    expect(mocks.audit.mock.calls.map(([, input]) => input.event)).toEqual(["PAYMENT_CREATED", "RECEIPT_CREATED"]);
  });
  it("authorizes before any protected business read", async () => {
    await recordCashPaymentAction(form()); expect(mocks.authority).toHaveBeenCalledWith(mocks.tx, { villageId: "v", permission: "collector", fundIds: ["f"], houseIds: ["h"] });
    expect(mocks.authority.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.fund.findFirst.mock.invocationCallOrder[0]);
  });
  it("rejects changed terms and closed collection windows", async () => {
    mocks.tx.fund.findFirst.mockResolvedValueOnce({ status: "ACTIVE", termsVersion: 3 });
    expect(await recordCashPaymentAction(form())).toMatchObject({ success: false, formError: "Fund details have changed. Reload the payment form." });
    mocks.tx.$queryRaw.mockResolvedValue([{ open: false }]);
    expect(await recordCashPaymentAction(form())).toMatchObject({ success: false, formError: "This fund is not open for payment today." });
    expect(mocks.tx.payment.create).not.toHaveBeenCalled();
  });
  it("rejects duplicate payment without another audit", async () => {
    mocks.tx.payment.findFirst.mockResolvedValue({ id: "old" });
    expect(await recordCashPaymentAction(form())).toMatchObject({ success: false, formError: "A valid payment already exists for this fund and house." });
    expect(mocks.tx.payment.create).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(["record", "void"] as const)("maps permanent %s authority denial without retry", async (operation) => {
    mocks.authority.mockRejectedValue(new TransactionAuthorityError("VFC_AUTH_COLLECTOR"));
    await expect(operation === "record" ? recordCashPaymentAction(form()) : voidPaymentAction(form())).rejects.toMatchObject({ path: "/forbidden" });
    expect(mocks.transaction).toHaveBeenCalledTimes(1); expect(mocks.tx.payment.create).not.toHaveBeenCalled(); expect(mocks.tx.payment.update).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("repeats authority after confirmed commit-time failure", async () => {
    mocks.transaction.mockImplementationOnce(async (callback: (tx: typeof mocks.tx) => Promise<unknown>) => { await callback(mocks.tx); throw { code: "40001" }; });
    expect(await recordCashPaymentAction(form())).toEqual({ success: true }); expect(mocks.authority).toHaveBeenCalledTimes(2);
  });
  it("propagates audit and ambiguous connection failures without replay", async () => {
    const failure = { code: "08006" }; mocks.audit.mockRejectedValue(failure);
    await expect(recordCashPaymentAction(form())).rejects.toBe(failure); expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });
  it.each(["ACTIVE", "CLOSED"] as const)("void honors %s status and emits both linked events only when permitted", async (status) => {
    mocks.authority.mockResolvedValue({ actor: { id: "collector" }, funds: [{ id: "f", status }] });
    mocks.tx.payment.findFirst.mockResolvedValue({ id: "p", fundId: "f", houseId: "h", status: "ACCEPTED", fundHouseAssessmentId: "a", amount: 1001 });
    expect(await voidPaymentAction(form())).toMatchObject({ success: status === "ACTIVE" });
    expect(mocks.audit.mock.calls.map(([, input]) => input.event)).toEqual(status === "ACTIVE" ? ["PAYMENT_VOIDED", "RECEIPT_VOIDED"] : []);
    if (status === "CLOSED") expect(mocks.tx.payment.update).not.toHaveBeenCalled();
  });
});

describe("assessment and audit failure boundaries", () => {
  it("queries assessment by the complete tenant/Fund/House identity", async () => {
    expect(await recordCashPaymentAction(form({ fundHouseAssessmentId: "foreign-assessment" }))).toEqual({ success: true });
    expect(mocks.tx.fundHouseAssessment.findFirst).toHaveBeenCalledWith({ where: { fundId: "f", houseId: "h", villageId: "v" } });
    expect(mocks.tx.payment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ fundHouseAssessmentId: "a" }) });
  });
  it("rejects absent frozen assessment without attempting writes", async () => {
    mocks.tx.fundHouseAssessment.findFirst.mockResolvedValue(null);
    expect(await recordCashPaymentAction(form())).toMatchObject({ success: false, formError: "This house has no assessment for the selected fund." });
    expect(mocks.tx.payment.create).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("propagates void audit failure without retrying permanent failure", async () => {
    mocks.tx.payment.findFirst.mockResolvedValue({ id: "p", fundId: "f", houseId: "h", status: "ACCEPTED", fundHouseAssessmentId: "a", amount: 1001 });
    const failure = { code: "23503", constraint: "AuditLog_actorUserId_fkey" }; mocks.audit.mockRejectedValue(failure);
    await expect(voidPaymentAction(form())).rejects.toBe(failure);
    expect(mocks.transaction).toHaveBeenCalledTimes(1); expect(mocks.tx.payment.update).toHaveBeenCalledTimes(1);
    // Real rollback is separately covered with PostgreSQL; mocks prove propagation only.
  });
});

describe("expired ACTIVE void contract (controlled transaction-client fixture)", () => {
  it("voids Payment and Receipt after expiry without applying the new-payment window", async () => {
    // Immutable historical dates are supplied by this unit fixture; no database
    // protection or production clock is changed. PostgreSQL history execution
    // remains a later gate; the actual action and event flow run here.
    mocks.authority.mockResolvedValue({ actor: { id: "collector" }, funds: [{ id: "f", status: "ACTIVE", startDate: new Date("2020-01-01"), endDate: new Date("2020-01-02") }] });
    mocks.tx.payment.findFirst.mockResolvedValue({ id: "p", fundId: "f", houseId: "h", status: "ACCEPTED", fundHouseAssessmentId: "a", amount: 1001 });
    expect(await voidPaymentAction(form())).toEqual({ success: true });
    expect(mocks.tx.payment.update).toHaveBeenCalledWith({ where: { id: "p" }, data: { status: "VOIDED", voidReason: "Wrong payer selected" } });
    expect(mocks.tx.receipt.update).toHaveBeenCalledWith({ where: { id: "r" }, data: { status: "VOIDED" } });
    expect(mocks.audit.mock.calls.map(([, input]) => input.event)).toEqual(["PAYMENT_VOIDED", "RECEIPT_VOIDED"]);
    expect(mocks.tx.$queryRaw.mock.calls.every(([sql]) => !String(sql).includes("vfc_payment_window"))).toBe(true);
  });
});
