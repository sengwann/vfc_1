/** Mocked page/query boundaries and real static UI rendering; no database/browser. */
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ chief: vi.fn(), admin: vi.fn(), village: vi.fn(), platform: vi.fn(), chiefRows: vi.fn(), adminRows: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireChief: m.chief, requireSystemAdmin: m.admin }));
vi.mock("@/features/shell/lib/shell-context", () => ({ getVillageShellContext: m.village, getPlatformShellContext: m.platform }));
vi.mock("@/features/audit/lib/audit-queries", () => ({ getChiefAuditLogs: m.chiefRows, getPlatformAuditLogs: m.adminRows }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// The audit parser imports the audit barrel, which also exports a Prisma writer.
// No database access is needed by these caller tests.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import VillageAuditPage from "@/app/(village)/village/audit/page";
import PlatformAuditPage from "@/app/(platform)/admin/audit/page";
import { AuditFiltersForm } from "./components/audit-filters-form";
import { AuditPagination } from "./components/audit-pagination";
import { TranslationProvider } from "@/lib/i18n/provider";
import { getT } from "@/lib/i18n/translations";
import type { SearchParams } from "./lib/audit-filters";

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
beforeEach(() => {
  vi.resetAllMocks();
  m.chief.mockResolvedValue({ villageId: "trusted-village" });
  m.admin.mockResolvedValue({ id: "admin" });
  m.village.mockResolvedValue({ language: "EN" }); m.platform.mockResolvedValue({ language: "EN" });
  m.chiefRows.mockResolvedValue({ logs: [], total: 51, totalPages: 3 });
  m.adminRows.mockResolvedValue({ logs: [], total: 51, totalPages: 3 });
});
for (const target of ["village", "platform"] as const) {
  const request = (params: SearchParams) => target === "village"
    ? VillageAuditPage({ searchParams: Promise.resolve(params) })
    : PlatformAuditPage({ searchParams: Promise.resolve(params) });
  const reader = () => target === "village" ? m.chiefRows : m.adminRows;
  const guard = () => target === "village" ? m.chief : m.admin;
  describe(`${target} audit date callers`, () => {
    for (const language of ["EN", "MY"] as const) {
      it.each([
        [{ dateFrom: "2026-02-30" }, "INVALID_FROM", "audit.filters.dateInvalid"],
        [{ dateTo: "bad" }, "INVALID_TO", "audit.filters.dateInvalid"],
        [{ dateFrom: "2026-02-02", dateTo: "2026-02-01" }, "REVERSED", "audit.filters.dateReversed"],
        [{ dateFrom: ["2026-01-01", "2026-01-01"] }, "REPEATED_FROM", "audit.filters.dateRepeated"],
        [{ dateTo: ["2026-01-01", "2026-02-01"] }, "REPEATED_TO", "audit.filters.dateRepeated"],
      ] as const)(`${language} offers correction without querying or showing empty results: %j`, async (params, error, key) => {
        m.village.mockResolvedValue({ language }); m.platform.mockResolvedValue({ language });
        // Readonly table fixtures are copied into the mutable URL parameter contract.
        const input: SearchParams = Object.fromEntries(Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? [...v] : v]));
        const page = await request(input);
        expect(guard()).toHaveBeenCalledTimes(1);
        expect(m.chiefRows).not.toHaveBeenCalled(); expect(m.adminRows).not.toHaveBeenCalled();
        const children = elements(page);
        const form = children.find((child) => child.type === AuditFiltersForm);
        expect(form?.props.dateError).toBe(error);
        expect(form?.props.initialDateFrom).toBe(Array.isArray(input.dateFrom) ? input.dateFrom[0] : input.dateFrom ?? "");
        expect(children.some((child) => child.type === AuditPagination)).toBe(false);
        const markup = renderToStaticMarkup(createElement(TranslationProvider, { language }, page));
        const t = getT(language);
        expect(markup).toContain('role="alert"');
        expect(markup).toContain(t(key)); expect(markup).toContain(t("audit.filters.timezone"));
        expect(markup).not.toContain(t("audit.empty.body"));
        if (error === "INVALID_FROM") expect(markup).toContain('value="2026-02-30"');
      });
    }
    it("passes normalized bounds and preserves filters on pagination links", async () => {
      const page = await request({ dateFrom: "2026-11-15", dateTo: "2026-11-16", actionType: "CREATE", entityType: "VILLAGE", page: "2", villageId: "untrusted" });
      expect(guard().mock.invocationCallOrder[0]).toBeLessThan(reader().mock.invocationCallOrder[0]);
      expect(reader()).toHaveBeenCalledWith({ ...(target === "village" ? { villageId: "trusted-village" } : {}), filters: {
        actionType: "CREATE", entityType: "VILLAGE", page: 2,
        dateRange: { ok: true, from: "2026-11-15", to: "2026-11-16", gte: new Date("2026-11-14T17:30:00Z"), lt: new Date("2026-11-16T17:30:00Z") },
      } });
      const pagination = elements(page).find((child) => child.type === AuditPagination);
      expect(pagination?.props.currentPage).toBe(2);
      const markup = renderToStaticMarkup(pagination!);
      expect(markup).toContain("dateFrom=2026-11-15"); expect(markup).toContain("dateTo=2026-11-16");
      expect(markup).toContain("actionType=CREATE"); expect(markup).toContain("page=3");
      if (target === "village") expect(markup).toContain("entityType=VILLAGE");
      expect(markup).not.toContain("untrusted");
    });
    it("denies unauthorized requests before loading audit data even for invalid dates", async () => {
      const denied = new Error("forbidden"); guard().mockRejectedValue(denied);
      await expect(request({ dateFrom: "bad" })).rejects.toBe(denied);
      expect(m.chiefRows).not.toHaveBeenCalled(); expect(m.adminRows).not.toHaveBeenCalled();
    });
    it("propagates unexpected query failures", async () => {
      const failure = new Error("database unavailable"); reader().mockRejectedValue(failure);
      await expect(request({ dateFrom: "2026-11-15" })).rejects.toBe(failure);
    });
  });
}
