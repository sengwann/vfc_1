/** Page wiring and real EN/MY presentation; no database/browser verification. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ chief: vi.fn(), shell: vi.fn(), logs: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireChief: m.chief }));
vi.mock("@/features/shell/lib/shell-context", () => ({ getVillageShellContext: m.shell }));
vi.mock("@/features/audit/lib/audit-queries", () => ({ getChiefFundAuditLogs: m.logs }));
vi.mock("@/features/fund-management/lib/fund-lifecycle-history", () => ({ withChiefFundHistorySnapshot: m.snapshot }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), notFound: () => { throw new Error("unavailable"); } }));
import Page from "@/app/(village)/village/funds/[fundId]/audit/page";
import { TranslationProvider } from "@/lib/i18n/provider";
import { getT } from "@/lib/i18n/translations";
beforeEach(() => {
  vi.resetAllMocks(); m.chief.mockResolvedValue({ villageId: "v" }); m.shell.mockResolvedValue({ language: "EN" });
  m.logs.mockResolvedValue({ fund: { id: "f", name: "Fund" }, logs: [{ id: "log", fundId: "f", actionType: "UPDATE", entityType: "FUND_END_DATE_EXTENSION", entityId: "e", createdAt: new Date("2026-11-01"), actorName: null }], total: 26, totalPages: 2 });
  m.snapshot.mockImplementation(async (_id, body) => body({}, { id: "f", name: "Fund" }));
});
for (const language of ["EN", "MY"] as const) {
  it(`preserves Fund scope, filters and real detail links in ${language}`, async () => {
    m.shell.mockResolvedValue({ language });
    const page = await Page({ params: Promise.resolve({ fundId: "f" }), searchParams: { dateFrom: "2026-11-01", entityType: "FUND_END_DATE_EXTENSION" } });
    const html = renderToStaticMarkup(createElement(TranslationProvider, { language }, page));
    expect(html).toContain(getT(language)("funds.history.audit")); expect(html).toContain(getT(language)("funds.history.actorUnavailable"));
    expect(html).toContain('/village/audit/log'); expect(html).toContain('/village/funds/f/audit?'); expect(html).toContain('dateFrom=2026-11-01');
    expect(m.logs.mock.calls[0][0]).toBe("f");
  });
  it(`invalid/repeated dates keep editable recovery and never query audit rows in ${language}`, async () => {
    m.shell.mockResolvedValue({ language });
    const page = await Page({ params: { fundId: "f" }, searchParams: { dateFrom: ["bad", "other"] } });
    const html = renderToStaticMarkup(createElement(TranslationProvider, { language }, page));
    expect(m.logs).not.toHaveBeenCalled(); expect(m.snapshot).toHaveBeenCalled();
    expect(html).toContain(getT(language)("audit.filters.dateRepeated")); expect(html).toContain('value="bad"');
  });
}
it("denies preflight access and propagates unexpected reader errors", async () => {
  m.chief.mockRejectedValueOnce(new Error("denied")); await expect(Page({ params: { fundId: "f" } })).rejects.toThrow("denied"); expect(m.logs).not.toHaveBeenCalled();
  const error = new Error("database"); m.logs.mockRejectedValue(error); await expect(Page({ params: { fundId: "f" } })).rejects.toBe(error);
});
