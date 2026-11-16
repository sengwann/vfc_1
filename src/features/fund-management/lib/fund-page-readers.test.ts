/** Page wiring tests with mocked reads; these do not verify database isolation. */
import { Children, isValidElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  summary: vi.fn(), recentPayments: vi.fn(), receiptCount: vi.fn(), paymentCount: vi.fn(), chief: vi.fn(), transaction: vi.fn(), readOnly: vi.fn(), funds: vi.fn(),
  aggregate: vi.fn(), fund: vi.fn(), report: vi.fn(), window: vi.fn(),
  shell: vi.fn(), contact: vi.fn(), houseCount: vi.fn(), userCount: vi.fn(), collector: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({
  requireChief: m.chief,
  isChief: (user: { role: string }) => user.role === "CHIEF",
  isVillager: (user: { role: string }) => user.role === "VILLAGER",
  hasActiveMembership: (user: { membershipStatus: string }) => user.membershipStatus === "ACTIVE",
  getCurrentPeriod: () => ({ year: 2026, month: 11 }),
}));
vi.mock("@/features/shell/lib/shell-context", () => ({ getVillageShellContext: m.shell }));
vi.mock("@/features/analytics/lib/chief-analytics", () => ({ getChiefDemographicData: vi.fn() }));
vi.mock("@/features/analytics/lib/collector-analytics", () => ({ getCollectorCollectionSummary: m.summary }));
vi.mock("@/features/fund-management/lib/member-fund-query", () => ({ getMemberCurrentFund: vi.fn() }));
vi.mock("@/features/fund-management/lib/fund-lifecycle-history", () => ({ getChiefFundLifecycleHistory: async (id: string) => {
  await m.chief();
  const fund = await m.fund({ where: { id, villageId: "v" } });
  return { fund, extensions: [], stale: false, closureWarning: false, older: null };
} }));
vi.mock("@/features/fund-management/lib/fund-report-queries", () => ({ getChiefFundReport: m.report }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $transaction: m.transaction, fund: { findFirst: m.fund }, $queryRaw: m.window,
  user: { findFirst: m.contact, count: m.userCount }, house: { count: m.houseCount },
  collectorAssignment: { findFirst: m.collector },
  payment: { findMany: m.recentPayments, count: m.paymentCount }, receipt: { count: m.receiptCount },
} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
vi.mock("@/features/fund-management/components/fund-lifecycle-actions", () => ({ FundLifecycleActions: () => null }));
vi.mock("@/features/fund-management/components/payment-status-search", () => ({ PaymentStatusSearchSection: () => null }));
import { CollectorOverview, CollectorInsights } from "@/features/analytics/components/collector-overview";
import VillageDashboardPage from "@/app/(village)/village/dashboard/page";
import { TranslationProvider } from "@/lib/i18n/provider";
import { getT } from "@/lib/i18n/translations";
import { FundChangedRecovery } from "../components/fund-changed-recovery";
import FundsPage from "@/app/(village)/village/funds/page";
import FundDetailPage from "@/app/(village)/village/funds/[fundId]/page";
const record = () => ({
  id: "f", villageId: "v", name: "Fund", description: null, status: "ACTIVE", termsVersion: 2,
  villageTargetAmount: 100_001, startDate: new Date("2026-11-01"), endDate: new Date("2026-11-30"),
  createdAt: new Date("2026-11-01"), updatedAt: new Date("2026-11-01"),
});
const metrics = () => ({
  villageTargetAmount: 100_001, acceptedCollectionAmount: 100_001, remainingVillageTarget: 0,
  excessCollectionOverVillageTarget: 0, hasFrozenAssessments: true,
  expectedHouseholdAssessmentTotal: 100_100, roundingSurplus: 99,
  outstandingHouseholdObligations: 99_099, paidFrozenAssessmentCount: 1, unpaidFrozenAssessmentCount: 99, isComplete: false,
});
beforeEach(() => {
  vi.resetAllMocks();
  m.chief.mockResolvedValue({ villageId: "v", user: { id: "chief" } });
  m.shell.mockResolvedValue({
    context: { villageId: "v", user: { id: "chief", name: "Chief", role: "CHIEF", membershipStatus: "ACTIVE" } },
    collectorContext: null, isHeadOfHouse: true, awaitingChiefApproval: false, notifications: {},
  });
  m.summary.mockResolvedValue({ totalCollected: 12345, acceptedCount: 12 });
  m.contact.mockResolvedValue({ name: "Chief", phone: null });
  m.houseCount.mockResolvedValue(100);
  m.userCount.mockResolvedValue(200);
  m.collector.mockResolvedValue(null);
  m.fund.mockResolvedValue(record());
  m.funds.mockResolvedValue([record(), { ...record(), id: "second" }]);
  m.aggregate.mockResolvedValue([{ fundId: "f", _sum: { amount: 100_001 } }]);
  m.window.mockResolvedValue([{ expired: false }]);
  m.report.mockResolvedValue({ fund: record(), metrics: metrics() });
  m.transaction.mockImplementation(async (body) => body({
    $executeRaw: m.readOnly, fund: { findMany: m.funds }, payment: { groupBy: m.aggregate },
  }));
});
describe("Chief fund page presentation wiring", () => {
  it("loads the list in one read snapshot with one batch aggregate and no per-fund report", async () => {
    const page = await FundsPage({});
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.aggregate).toHaveBeenCalledTimes(1);
    expect(m.report).not.toHaveBeenCalled();
    expect(m.aggregate.mock.calls[0][0].where).toEqual({ villageId: "v", status: "ACCEPTED", fundId: { in: ["f", "second"] } });
    expect(page.props.funds).toEqual([
      expect.objectContaining({ id: "f", villageTargetAmount: 100_001, acceptedCollectionAmount: 100_001 }),
      expect.objectContaining({ id: "second", acceptedCollectionAmount: 0 }),
    ]);
    expect(m.readOnly.mock.invocationCallOrder[0]).toBeLessThan(m.funds.mock.invocationCallOrder[0]);
  });
  it("passes approved report metrics and unpaid coverage to Chief detail", async () => {
    const page = await FundDetailPage({ params: { fundId: "f" } });
    expect(m.fund.mock.calls[0][0].where).toEqual({ id: "f", villageId: "v" });
    expect(m.report).toHaveBeenCalledWith("f");
    expect(page.props.metrics).toEqual(metrics());
    expect(page.props.lifecycle.props.unpaidCount).toBe(99);
    expect(m.chief.mock.invocationCallOrder[0]).toBeLessThan(m.report.mock.invocationCallOrder[0]);
  });
  it("preserves DRAFT null metrics in detail", async () => {
    m.fund.mockResolvedValueOnce({ ...record(), status: "DRAFT" }).mockResolvedValueOnce(null);
    const draft = { ...metrics(), hasFrozenAssessments: false, acceptedCollectionAmount: 0,
      remainingVillageTarget: 100_001, expectedHouseholdAssessmentTotal: null, roundingSurplus: null,
      outstandingHouseholdObligations: null, paidFrozenAssessmentCount: null, unpaidFrozenAssessmentCount: null };
    m.report.mockResolvedValue({ fund: { ...record(), status: "DRAFT" }, metrics: draft });
    const page = await FundDetailPage({ params: { fundId: "f" } });
    expect(page.props.metrics).toEqual(draft);
    expect(page.props.paymentSearch).toBeNull();
    expect(page.props.lifecycle.props.unpaidCount).toBeUndefined();
  });
  it("keeps displayed-version expiry when an extension commits after the report snapshot", async () => {
    let stored = record();
    m.fund.mockImplementation(async () => ({ ...stored }));
    m.report.mockImplementation(async () => {
      const snapshot = { ...stored };
      // Simulate another transaction extending after the reader took its snapshot.
      stored = { ...stored, termsVersion: 3, endDate: new Date("2026-12-31") };
      return { fund: snapshot, metrics: metrics() };
    });
    m.window.mockImplementation(async (sql: TemplateStringsArray, endDay: string) => {
      // This inspects the query contract; it is not a PostgreSQL predicate test.
      expect(sql.join("?")).toContain("public.vfc_fund_expired(?::date,clock_timestamp())");
      expect(sql.join("?")).not.toContain('FROM public."Fund"');
      expect(endDay).toBe("2026-11-30");
      return [{ expired: true }];
    });
    const page = await FundDetailPage({ params: { fundId: "f" } });
    expect(stored.termsVersion).toBe(3);
    expect(stored.endDate.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(page.props.fund.endDate).toBe("2026-11-30T00:00:00.000Z");
    expect(page.props.fund.status).toBe("ACTIVE");
    expect(page.props.lifecycle.props).toMatchObject({ termsVersion: 2, status: "ACTIVE", endDate: "2026-11-30", expired: true });
    expect(m.fund).toHaveBeenCalledTimes(1);
    expect(m.window).toHaveBeenCalledTimes(1);
  });
  it("denies non-Chief requests before report or list reads", async () => {
    m.chief.mockRejectedValue(new Error("forbidden"));
    await expect(FundDetailPage({ params: { fundId: "f" } })).rejects.toThrow("forbidden");
    await expect(FundsPage({})).rejects.toThrow("forbidden");
    expect(m.report).not.toHaveBeenCalled(); expect(m.transaction).not.toHaveBeenCalled();
  });
});


for (const language of ["EN", "MY"] as const) {
  describe(`concurrent fund-change recovery in ${language}`, () => {
    for (const target of ["dashboard", "detail"] as const) {
      it.each([
        { termsVersion: 3, status: "ACTIVE" },
        { termsVersion: 3, status: "CLOSED" },
      ])(`${target} offers localized reload without rendering mixed data: %j`, async (change) => {
        const reportMetrics = change.status === "CLOSED" ? {
          ...metrics(), acceptedCollectionAmount: 199_100, excessCollectionOverVillageTarget: 99_099,
          outstandingHouseholdObligations: 0, paidFrozenAssessmentCount: 100,
          unpaidFrozenAssessmentCount: 0, isComplete: true,
        } : metrics();
        m.report.mockResolvedValue({ fund: { ...record(), ...change }, metrics: reportMetrics });
        const page = target === "dashboard"
          ? await VillageDashboardPage()
          : await FundDetailPage({ params: { fundId: "f" } });
        expect(page.type).toBe(FundChangedRecovery);
        const retryHref = target === "dashboard" ? "/village/dashboard" : "/village/funds/f";
        expect(page.props.retryHref).toBe(retryHref);
        const markup = renderToStaticMarkup(createElement(TranslationProvider, { language }, page));
        const t = getT(language);
        expect(markup).toContain(t("funds.changed.title"));
        expect(markup).toContain(t("funds.changed.description"));
        expect(markup).toContain(t("funds.changed.retry"));
        expect(markup).toContain(`action="${retryHref}"`);
        expect(markup).toContain('method="get"');
        expect(markup).toContain('type="submit"');
        expect(markup).not.toContain(t("funds.metrics.outstanding"));
        expect(markup).not.toContain("100,001");
        expect(m.window).not.toHaveBeenCalled();
      });
    }
  });
}

describe("concurrent-change recovery boundaries", () => {
  it.each(["dashboard", "detail"] as const)("%s continues propagating unexpected reader errors", async (target) => {
    const error = new Error("Unexpected database error");
    m.report.mockRejectedValue(error);
    const request = target === "dashboard" ? VillageDashboardPage() : FundDetailPage({ params: { fundId: "f" } });
    await expect(request).rejects.toBe(error);
  });
  it("propagates a failed canonical expiry query instead of showing change recovery", async () => {
    const error = new Error("Expiry query failed");
    m.window.mockRejectedValue(error);
    await expect(FundDetailPage({ params: { fundId: "f" } })).rejects.toBe(error);
  });
});

it.each(["CHIEF", "VILLAGER"])("passes one lifetime summary consistently to collector components for %s", async (role) => {
  const shell = await m.shell();
  const id = role === "CHIEF" ? "chief" : "collector";
  m.shell.mockResolvedValue({ ...shell, context: { ...shell.context, user: { ...shell.context.user, id, role } }, collectorContext: { assignment: { year: 2026, month: 11 } } });
  const summary = { totalCollected: 98765, acceptedCount: 37 };
  m.summary.mockResolvedValue(summary);
  m.recentPayments.mockResolvedValue([]);m.receiptCount.mockResolvedValue(0);
  const page = await VillageDashboardPage();
  const children = Children.toArray(page.props.children);
  const overview = children.find((child) => isValidElement(child) && child.type === CollectorOverview);
  const insights = children.find((child) => isValidElement(child) && child.type === CollectorInsights);
  expect(isValidElement(overview)).toBe(true);expect(isValidElement(insights)).toBe(true);
  if (!isValidElement<{ data: { lifetimeAcceptedCount: number } }>(overview) || !isValidElement<{ data: typeof summary }>(insights)) throw new Error("Collector components absent");
  expect(overview.props.data.lifetimeAcceptedCount).toBe(summary.acceptedCount);
  expect(insights.props.data).toBe(summary);
  expect(insights.props.data.acceptedCount).toBe(overview.props.data.lifetimeAcceptedCount);
  expect(m.summary).toHaveBeenCalledExactlyOnceWith("v", id);
  expect(m.paymentCount).not.toHaveBeenCalled();
  // Only the Villager's existing bounded personal history read is allowed.
  expect(m.recentPayments).toHaveBeenCalledTimes(role === "VILLAGER" ? 1 : 0);
  if(role === "VILLAGER") expect(m.recentPayments.mock.calls[0][0]).toMatchObject({where:{villageId:"v",payerUserId:id},take:5});
});
