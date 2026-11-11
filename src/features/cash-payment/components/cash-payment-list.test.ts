/** Actual component rendering; navigation and the void action are external boundaries. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FundStatus, PaymentStatus } from "@prisma/client";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../actions/void-payment.action", () => ({ voidPaymentAction: vi.fn() }));
import { TranslationProvider } from "@/lib/i18n/provider";
import { CashPaymentList } from "./cash-payment-list";
function render(status: PaymentStatus, fundStatus: FundStatus, endDate = "2027-12-31") {
  const payment = { id: "original-payment", amount: 1001, status, createdAt: new Date("2026-01-01T00:00:00Z"),
    voidReason: status === "VOIDED" ? "Wrong payer selected" : null,
    assessment: { houseNumberSnapshot: "FROZEN-H1" },
    house: { houseNumber: "LIVE-RENUMBERED" }, fund: { status: fundStatus, endDate: new Date(endDate) }, payer: { name: "Payer" } };
  return renderToStaticMarkup(createElement(TranslationProvider, { language: "EN", children: createElement(CashPaymentList, { payments: [payment] }) }));
}
describe("cash history identity and void controls", () => {
  it("renders frozen identity, amount, payer and transaction date", () => {
    const html = render("ACCEPTED", "ACTIVE");
    expect(html).toContain("FROZEN-H1"); expect(html).not.toContain("LIVE-RENUMBERED");
    expect(html).toContain("1,001"); expect(html).toContain("Payer"); expect(html).toContain("2026-01-01T00:00:00.000Z");
    expect(html).toContain('value="original-payment"');
  });
  it.each([
    ["ACCEPTED", "ACTIVE", true], ["ACCEPTED", "CLOSED", false],
    ["VOIDED", "ACTIVE", false], ["VOIDED", "CLOSED", false],
  ] as const)("%s Payment in its own %s Fund: void=%s", (status, fund, canVoid) => {
    const html = render(status, fund);
    expect(html.includes('<details')).toBe(canVoid);
    expect(html.includes('name="paymentId"')).toBe(canVoid);
    if (status === "VOIDED") expect(html).toContain("Wrong payer selected");
  });
  it("retains void for expired but ACTIVE Funds", () => {
    expect(render("ACCEPTED", "ACTIVE", "2020-01-01")).toContain('name="paymentId"');
  });
});
