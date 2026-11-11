/** Actual rendered forms; action/navigation boundaries mocked. No browser events. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../actions/update-fund.action", () => ({ updateFundAction: vi.fn() }));
vi.mock("../actions/activate-fund.action", () => ({ activateFundAction: vi.fn() }));
vi.mock("../actions/extend-fund.action", () => ({ extendFundAction: vi.fn() }));
vi.mock("../actions/close-fund.action", () => ({ closeFundAction: vi.fn() }));
import { TranslationProvider } from "@/lib/i18n/provider";
import { EditFundForm } from "./edit-fund-form";
import { ExtendFundForm } from "./extend-fund-form";
import { FundLifecycleActions } from "./fund-lifecycle-actions";
function html(element: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(createElement(TranslationProvider, { language: "EN" }, element));
}
function hidden(markup: string) {
  const data = new FormData();
  for (const tag of markup.match(/<input\b[^>]*>/g) ?? []) {
    const name = /name="([^"]*)"/.exec(tag)?.[1], value = /value="([^"]*)"/.exec(tag)?.[1];
    if (tag.includes('type="hidden"') && name && value !== undefined) data.set(name, value);
  }
  return data;
}
describe("draft/activation rendered caller identity", () => {
  it("edit preserves the village target and submits the displayed version", () => {
    const markup = html(createElement(EditFundForm, { fundId: "displayed", termsVersion: 4, initialName: "Fund", initialDescription: "", initialTargetAmount: "100001", initialStartDate: "2026-01-01", initialEndDate: "2026-12-31" }));
    const data = hidden(markup);
    expect(data.get("fundId")).toBe("displayed"); expect(data.get("termsVersion")).toBe("4");
    expect(markup).toContain('value="100001"');
  });
  it("activation carries the displayed Fund ID and version", () => {
    const data = hidden(html(createElement(FundLifecycleActions, { fundId: "displayed", termsVersion: 4, status: "DRAFT", hasOtherActiveFund: false })));
    expect(data.get("fundId")).toBe("displayed"); expect(data.get("termsVersion")).toBe("4");
  });
});

describe("completion form identity", () => {
  it("closure submits current Fund ID/version before confirmation", () => {
    const data = hidden(html(createElement(FundLifecycleActions, { fundId: "paid", termsVersion: 5, status: "ACTIVE", hasOtherActiveFund: false, unpaidCount: 0, expired: false })));
    expect(data.get("fundId")).toBe("paid"); expect(data.get("termsVersion")).toBe("5");
  });
  it("extension includes date, reason, Fund ID and version", () => {
    const markup = html(createElement(ExtendFundForm, { fundId: "expired", termsVersion: 7, endDate: "2026-01-01" }));
    const data = hidden(markup); expect(data.get("fundId")).toBe("expired"); expect(data.get("termsVersion")).toBe("7");
    expect(markup).toContain('name="newEndDate"'); expect(markup).toContain('name="reason"'); expect(markup).toContain("2026-01-01");
  });
  it("does not offer closure for unpaid houses or financial actions on CLOSED Funds", () => {
    for (const status of ["ACTIVE", "CLOSED"] as const) {
      const data = hidden(html(createElement(FundLifecycleActions, { fundId: "f", termsVersion: 2, status, hasOtherActiveFund: false, unpaidCount: 1, expired: false })));
      expect(data.get("fundId")).toBeNull();
    }
  });
});
