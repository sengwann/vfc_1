/** Real page -> access loader -> view -> form markup -> real action.
 * Database/authority/navigation are unit boundaries. HTML form serialization is
 * modeled from actual rendered hidden inputs; this is not a browser event test. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  fund: vi.fn(), payments: vi.fn(), liveHouses: vi.fn(), authority: vi.fn(), audit: vi.fn(),
  tx: { fund: { findFirst: vi.fn() }, fundHouseAssessment: { findFirst: vi.fn() }, user: { findFirst: vi.fn() }, payment: { findFirst: vi.fn(), create: vi.fn() }, receipt: { create: vi.fn() }, $queryRaw: vi.fn() },
  transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { fund: { findFirst: mocks.fund }, payment: { findMany: mocks.payments }, house: { findMany: mocks.liveHouses }, $transaction: mocks.transaction } }));
vi.mock("@/lib/authz", () => ({ requireActiveCollector: async () => ({ villageId: "v" }) }));
vi.mock("@/lib/authz/transaction-authority", async (original) => ({ ...await original<typeof import("@/lib/authz/transaction-authority")>(), authorizeFinancialTransaction: mocks.authority }));
vi.mock("@/lib/audit/financial-audit", () => ({ createFinancialAudit: mocks.audit }));
vi.mock("@/lib/receipts/receipt-number", () => ({ generateReceiptNumber: async () => "TEST-1" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: (path: string) => { throw new Error(path); } }));
import CashPage from "@/app/(village)/village/cash/page";
import { TranslationProvider } from "@/lib/i18n/provider";
import { recordCashPaymentAction } from "../actions/record-cash-payment.action";
const snapshot = () => ({ id: "displayed-fund", name: "Fund", villageTargetAmount: 100001, termsVersion: 2, assessmentPerHouse: 1001,
  assessments: [{ id: "assessment", houseId: "snapshot-house", houseNumberSnapshot: "Frozen H1", assessmentAmount: 1001, house: { members: [{ id: "payer", name: "Payer" }] } }] });
async function renderedForm() {
  const element = await CashPage();
  const html = renderToStaticMarkup(createElement(TranslationProvider, { language: "EN", children: element }));
  const data = new FormData();
  for (const tag of html.match(/<input\b[^>]*>/g) ?? []) {
    if (!tag.includes('type="hidden"')) continue;
    const name = /name="([^"]*)"/.exec(tag)?.[1], value = /value="([^"]*)"/.exec(tag)?.[1];
    if (name && value !== undefined) data.set(name, value);
  }
  // Models the user's choices; protected fields come only from rendered markup.
  data.set("houseId", "snapshot-house"); data.set("payerUserId", "payer"); data.set("amount", "1001");
  return { html, data };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.fund.mockResolvedValue(snapshot()); mocks.payments.mockResolvedValue([]);
  mocks.transaction.mockImplementation((body: (tx: typeof mocks.tx) => Promise<unknown>) => body(mocks.tx));
  mocks.authority.mockResolvedValue({ actor: { id: "collector" }, houses: [{ id: "snapshot-house", isActive: true }] });
  mocks.tx.fund.findFirst.mockResolvedValue({ id: "displayed-fund", status: "ACTIVE", termsVersion: 2 });
  mocks.tx.fundHouseAssessment.findFirst.mockResolvedValue({ id: "assessment", assessmentAmount: 1001 });
  mocks.tx.user.findFirst.mockResolvedValue({ id: "payer" }); mocks.tx.payment.findFirst.mockResolvedValue(null);
  mocks.tx.payment.create.mockResolvedValue({ id: "payment" }); mocks.tx.receipt.create.mockResolvedValue({ id: "receipt" }); mocks.tx.$queryRaw.mockResolvedValue([{ open: true }]);
});
describe("cash payment caller contract", () => {
  it("loads frozen history and gates void by each payment's own Fund", async () => {
    const payment = { id: "active-payment", amount: 1001, status: "ACCEPTED", createdAt: new Date("2026-01-01"), voidReason: null,
      assessment: { houseNumberSnapshot: "HISTORY-FROZEN" }, house: { houseNumber: "LIVE-HISTORY-NUMBER" },
      fund: { status: "ACTIVE" }, payer: { name: "Payer" } };
    mocks.payments.mockResolvedValue([payment, { ...payment, id: "closed-payment", fund: { status: "CLOSED" } }]);
    const { html } = await renderedForm();
    expect(html).toContain("HISTORY-FROZEN"); expect(html).not.toContain("LIVE-HISTORY-NUMBER");
    expect(html).toContain('value="active-payment"'); expect(html).not.toContain('value="closed-payment"');
    expect(mocks.payments).toHaveBeenCalledWith(expect.objectContaining({ where: { villageId: "v" }, select: expect.objectContaining({ assessment: { select: { houseNumberSnapshot: true } }, fund: { select: { status: true } } }) }));
  });
  it("renders and submits the displayed Fund identity/version and frozen amount through the real action", async () => {
    const { html, data } = await renderedForm();
    expect(data.get("fundId")).toBe("displayed-fund"); expect(data.get("termsVersion")).toBe("2");
    expect(html).toContain("1,001"); expect(html).toContain("100,001"); expect(html).toContain('value="snapshot-house"'); expect(html).toContain("Frozen H1");
    expect(await recordCashPaymentAction(data)).toEqual({ success: true });
    expect(mocks.tx.payment.create).toHaveBeenCalledWith({ data: expect.objectContaining({ fundId: "displayed-fund", houseId: "snapshot-house", fundHouseAssessmentId: "assessment", amount: 1001 }) });
  });
  it("uses only snapshot Houses, with tenant-filtered active payer choices", async () => {
    // A live-House query would expose this new House; the real page must not use it.
    mocks.liveHouses.mockResolvedValue([{ id: "new-house", houseNumber: "NEW-H2" }]);
    const { html } = await renderedForm();
    expect(html).not.toContain('value="new-house"'); expect(html).not.toContain("NEW-H2"); expect(mocks.liveHouses).not.toHaveBeenCalled();
    expect(mocks.fund).toHaveBeenCalledWith(expect.objectContaining({
      where: { villageId: "v", status: "ACTIVE" },
      select: expect.objectContaining({
        termsVersion: true,
        assessments: expect.objectContaining({
          where: { villageId: "v" },
          select: expect.objectContaining({
            assessmentAmount: true, houseNumberSnapshot: true,
            house: { select: { members: {
              where: { villageId: "v", membershipStatus: "ACTIVE" },
              orderBy: [{ name: "asc" }, { id: "asc" }],
              select: { id: true, name: true },
            } } },
          }),
        }),
      }),
    }));
  });
  it.each(["fundId", "termsVersion"])("rejects missing %s from an otherwise real form", async (field) => {
    const { data } = await renderedForm(); data.delete(field);
    expect(await recordCashPaymentAction(data)).toMatchObject({ success: false, formError: "Fund details have changed. Reload the payment form." });
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.tx.payment.create).not.toHaveBeenCalled();
  });
  it("rejects a displayed terms version made stale after rendering", async () => {
    const { data } = await renderedForm(); mocks.tx.fund.findFirst.mockResolvedValue({ id: "displayed-fund", status: "ACTIVE", termsVersion: 3 });
    expect(await recordCashPaymentAction(data)).toMatchObject({ success: false, formError: "Fund details have changed. Reload the payment form." });
    expect(mocks.tx.payment.create).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("never redirects a stale form into a different active Fund", async () => {
    const { data } = await renderedForm(); mocks.fund.mockResolvedValue({ ...snapshot(), id: "new-active-fund" });
    mocks.tx.fund.findFirst.mockResolvedValue({ id: "displayed-fund", status: "CLOSED", termsVersion: 3 });
    expect(await recordCashPaymentAction(data)).toMatchObject({ success: false, formError: "This fund is no longer active." });
    expect(mocks.authority).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ fundIds: ["displayed-fund"] }));
    expect(mocks.tx.fund.findFirst).toHaveBeenCalledWith({ where: { id: "displayed-fund", villageId: "v" } });
    expect(mocks.fund).toHaveBeenCalledTimes(1); expect(mocks.tx.payment.create).not.toHaveBeenCalled();
  });
});
