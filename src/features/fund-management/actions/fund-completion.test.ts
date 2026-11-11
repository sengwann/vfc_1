/** Real actions, transaction logic and retry; authority/DB/audit/navigation are unit boundaries. */
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ transaction: vi.fn(), authority: vi.fn(), audit: vi.fn(), tx: {
  fund: { findFirstOrThrow: vi.fn(), update: vi.fn() }, fundHouseAssessment: { count: vi.fn() },
  payment: { count: vi.fn() }, fundEndDateExtension: { create: vi.fn() }, $queryRaw: vi.fn(),
} }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/authz", () => ({ requireChief: async () => ({ villageId: "v" }) }));
vi.mock("@/lib/authz/transaction-authority", async (original) => ({ ...await original<typeof import("@/lib/authz/transaction-authority")>(), authorizeFinancialTransaction: m.authority }));
vi.mock("@/lib/audit/financial-audit", () => ({ createFinancialAudit: m.audit }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Object.assign(new Error("navigation"), { path }); } }));
import { TransactionAuthorityError } from "@/lib/authz/transaction-authority";
import { extendFundAction } from "./extend-fund.action";
import { closeFundAction } from "./close-fund.action";
const now = new Date("2026-01-02T00:00:00Z");
function form() { const f = new FormData(); for (const [k,v] of Object.entries({ fundId: "f", termsVersion: "2", newEndDate: "2026-01-02", reason: "Unpaid houses" })) f.set(k,v); return f; }
beforeEach(() => {
  vi.resetAllMocks(); m.transaction.mockImplementation((body: (tx: typeof m.tx) => Promise<unknown>) => body(m.tx));
  m.authority.mockResolvedValue({ actor: { id: "chief" } });
  m.tx.fund.findFirstOrThrow.mockResolvedValue({ id: "f", status: "ACTIVE", termsVersion: 2, endDate: new Date("2026-01-01") });
  m.tx.fundHouseAssessment.count.mockResolvedValue(1); m.tx.payment.count.mockResolvedValue(2);
  m.tx.$queryRaw.mockResolvedValue([{ expired: true, now }]);
  m.tx.fundEndDateExtension.create.mockResolvedValue({ id: "extension", reason: "Unpaid houses" });
  m.tx.fund.update.mockResolvedValue({ id: "f", termsVersion: 3 });
});
describe("Phase 6 action contracts", () => {
  it("extends with history before Fund update and a linked audit", async () => {
    expect(await extendFundAction(form())).toEqual({ success: true });
    expect(m.authority).toHaveBeenCalledWith(m.tx, { villageId: "v", permission: "chief", fundIds: ["f"] });
    expect(m.tx.fundEndDateExtension.create).toHaveBeenCalledWith({ data: expect.objectContaining({ previousEndDate: new Date("2026-01-01"), newEndDate: new Date("2026-01-02"), previousTermsVersion: 2, newTermsVersion: 3, changedByUserId: "chief", changedAt: now }) });
    expect(m.tx.fundEndDateExtension.create.mock.invocationCallOrder[0]).toBeLessThan(m.tx.fund.update.mock.invocationCallOrder[0]);
    expect(m.audit).toHaveBeenCalledWith(m.tx, expect.objectContaining({ event: "FUND_EXTENDED", fundId: "f", villageId: "v", actorUserId: "chief", metadata: { extensionId: "extension", previousEndDate: "2026-01-01", newEndDate: "2026-01-02", reason: "Unpaid houses", termsVersion: 3 } }));
  });
  it("permits a later extension date that is still in the past", async () => {
    m.tx.fund.findFirstOrThrow.mockResolvedValue({ id: "f", status: "ACTIVE", termsVersion: 2, endDate: new Date("2025-12-30") });
    const f = form(); f.set("newEndDate", "2025-12-31");
    expect(await extendFundAction(f)).toEqual({ success: true });
    expect(m.tx.fund.update).toHaveBeenCalledWith({ where: { id: "f" }, data: { endDate: new Date("2025-12-31"), termsVersion: { increment: 1 } } });
  });
  it.each(["ACTIVE", "CLOSED", "DRAFT"])("rejects stale/ineligible %s without mutations", async (status) => {
    m.tx.fund.findFirstOrThrow.mockResolvedValue({ id: "f", status, termsVersion: 3 });
    expect(await extendFundAction(form())).toMatchObject({ success: false });
    expect(m.tx.fund.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it.each(["not-expired", "paid", "earlier"])("rejects extension %s", async (kind) => {
    if (kind === "not-expired") m.tx.$queryRaw.mockResolvedValue([{ expired: false, now }]);
    if (kind === "paid") m.tx.fundHouseAssessment.count.mockResolvedValue(0);
    const f = form(); if (kind === "earlier") f.set("newEndDate", "2026-01-01");
    expect(await extendFundAction(f)).toMatchObject({ success: false, formError: kind === "not-expired" ? "Only expired funds can be extended." : kind === "paid" ? "Only funds with unpaid assessments can be extended." : "New end date must be later than the previous end date." });
    expect(m.tx.fundEndDateExtension.create).not.toHaveBeenCalled();
  });
  it.each(["2025-12-31", "2026-01-02", "2026-12-31"])("closes paid Fund ending %s without checking expiry", async (endDate) => {
    m.tx.fund.findFirstOrThrow.mockResolvedValue({ id: "f", status: "ACTIVE", termsVersion: 2, endDate: new Date(endDate) });
    m.tx.fundHouseAssessment.count.mockResolvedValue(0);
    await expect(closeFundAction(form())).rejects.toMatchObject({ path: "/village/funds/f" });
    expect(m.tx.fund.update).toHaveBeenCalledWith({ where: { id: "f" }, data: { status: "CLOSED", closedAt: now, closedByUserId: "chief", termsVersion: { increment: 1 } } });
    expect(m.audit).toHaveBeenCalledWith(m.tx, { villageId: "v", fundId: "f", actorUserId: "chief", event: "FUND_CLOSED", metadata: { closedAt: now.toISOString(), termsVersion: 3, acceptedPaymentCount: 2 } });
  });
  it("rejects unpaid closure before reading aggregate payments or writing", async () => {
    await expect(closeFundAction(form())).rejects.toMatchObject({ path: expect.stringContaining("lifecycleError=") });
    expect(m.tx.payment.count).not.toHaveBeenCalled(); expect(m.tx.fund.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
    expect(m.tx.fundHouseAssessment.count).toHaveBeenCalledWith({ where: { fundId: "f", villageId: "v", payments: { none: { status: "ACCEPTED" } } } });
  });
  it.each([["VFC_AUTH_SESSION", "/login"], ["VFC_AUTH_PASSWORD_CHANGE", "/change-password"], ["VFC_AUTH_ROLE", "/forbidden"]] as const)("maps %s without retry or writes", async (code,path) => {
    m.authority.mockRejectedValue(new TransactionAuthorityError(code));
    await expect(closeFundAction(form())).rejects.toMatchObject({ path });
    expect(m.transaction).toHaveBeenCalledTimes(1); expect(m.tx.fund.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("repeats authority after confirmed abort; never reuses an earlier grant", async () => {
    m.authority.mockRejectedValueOnce({ code: "40001" }).mockRejectedValueOnce(new TransactionAuthorityError("VFC_AUTH_ROLE"));
    await expect(closeFundAction(form())).rejects.toMatchObject({ path: "/forbidden" });
    expect(m.transaction).toHaveBeenCalledTimes(2); expect(m.tx.fund.update).not.toHaveBeenCalled();
  });
  it("propagates audit failures unchanged", async () => {
    const error = new Error("audit unavailable"); m.audit.mockRejectedValue(error);
    await expect(extendFundAction(form())).rejects.toBe(error);
  });
  it.each(["fundId", "termsVersion"])("rejects missing %s before transaction", async (field) => {
    const f = form(); f.delete(field); await extendFundAction(f); expect(m.transaction).not.toHaveBeenCalled();
  });
});
