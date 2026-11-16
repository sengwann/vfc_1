/** Static rendering only; interactive behavior and PostgreSQL need later verification. */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("../actions/search-payment-status.action", () => ({ searchPaymentStatusAction: vi.fn() }));
import { TranslationProvider } from "@/lib/i18n/provider";
import { getT } from "@/lib/i18n/translations";
import { calculateFundReportingMetrics } from "../lib/fund-reporting";
import type { HouseholdFundStatus } from "../lib/household-reporting-types";
import { FundSummaryCard } from "./fund-summary-card";
import { FundList } from "./fund-list";
import { PaymentStatusResult } from "./payment-status-search";
import { VillagerOverview } from "@/features/analytics/components/villager-overview";
import { CollectorOverview, CollectorInsights } from "@/features/analytics/components/collector-overview";
const fund = { id: "f", name: "Fund", villageTargetAmount: 100_001,
  startDate: new Date("2026-11-01"), endDate: new Date("2026-11-30") };
function html(language: "EN" | "MY", child: ReactElement) {
  return renderToStaticMarkup(createElement(TranslationProvider, { language }, child));
}
function metrics(draft = false) {
  const result = calculateFundReportingMetrics({
    status: draft ? "DRAFT" : "ACTIVE", villageTargetAmount: 100_001,
    assessments: draft ? [] : Array.from({ length: 100 }, (_, i) => ({
      id: `a${i}`, assessmentAmount: 1_001,
      payments: i === 0 ? [{ status: "ACCEPTED" as const, amount: 100_001 }] : [],
    })),
  });
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
for (const language of ["EN", "MY"] as const) {
  describe(`financial presentation in ${language}`, () => {
    const t = getT(language);
    it("separates target attainment from unpaid obligations in the mandatory overpayment example", () => {
      const data = metrics();
      expect(data).toMatchObject({ remainingVillageTarget: 0, outstandingHouseholdObligations: 99_099, unpaidFrozenAssessmentCount: 99, isComplete: false });
      const markup = html(language, createElement(FundSummaryCard, { metrics: data }));
      for (const key of ["funds.metrics.villageTarget", "funds.metrics.expected", "funds.metrics.outstanding", "funds.metrics.remainingTarget", "funds.metrics.excess", "funds.metrics.incomplete"] as const) {
        expect(markup).toContain(t(key));
      }
      expect(markup).toContain("100,100"); expect(markup).toContain("99,099");
      expect(markup).toContain(t("funds.summary.reached"));
      expect(markup).not.toContain(t("funds.metrics.complete"));
    });
    it("keeps draft frozen metrics null and visibly unassessed", () => {
      const data = metrics(true);
      expect(data.outstandingHouseholdObligations).toBeNull();
      expect(data.expectedHouseholdAssessmentTotal).toBeNull();
      const markup = html(language, createElement(FundSummaryCard, { metrics: data }));
      expect(markup).toContain(t("funds.metrics.notFrozen"));
      expect(markup).toContain(t("funds.metrics.draftNote"));
      expect(markup).not.toContain('role="progressbar"');
    });
    it.each(["NO_HOUSEHOLD", "NOT_ASSESSED"] as const)("does not request money for %s", (state) => {
      const household: HouseholdFundStatus = { state, assessmentAmount: null, outstandingAmount: null };
      const markup = html(language, createElement(VillagerOverview, { fund, data: { household, recentPayments: [], receiptsCount: 0 } }));
      expect(markup).toContain(t(state === "NO_HOUSEHOLD" ? "funds.household.noHousehold" : "funds.household.notAssessed"));
      expect(markup).not.toContain(t("dashboard.pay.cashInfo"));
      expect(markup).not.toContain(t("funds.household.outstanding"));
      expect(markup).not.toContain(t("funds.household.unpaid"));
    });
    it("shows the frozen household assessment for an unpaid assessed member", () => {
      const markup = html(language, createElement(VillagerOverview, { fund, data: {
        household: { state: "UNPAID", assessmentAmount: 1_001, outstandingAmount: 1_001 }, recentPayments: [], receiptsCount: 0,
      } }));
      expect(markup).toContain(t("funds.household.assessment"));
      expect(markup).toContain("1,001"); expect(markup).toContain(t("dashboard.pay.cashInfo"));
    });
    it.each(["NOT_ASSESSED", "UNPAID", "PAID"] as const)("renders search state %s", (status) => {
      const markup = html(language, createElement(PaymentStatusResult, { result: { id: "h", houseNumber: "H", headName: null, status } }));
      expect(markup).toContain(t(status === "PAID" ? "funds.household.paid" : status === "UNPAID" ? "funds.household.unpaid" : "funds.household.notAssessed"));
    });
    it("labels collector totals as lifetime within the village while identifying assignment period", () => {
      const markup = html(language, createElement(CollectorOverview, { data: { lifetimeAcceptedCount: 12 }, period: { year: 2026, month: 11 } }));
      expect(markup).toContain(t("dashboard.collector.accepted")); expect(markup).toContain("2026-11");
      const summary = html(language, createElement(CollectorInsights, { data: {
        totalCollected: 12_345, acceptedCount: 12,
      } }));
      expect(summary).toContain(t("dashboard.collector.summaryTitle"));
      expect(summary).toContain(t("dashboard.collector.totalCollected"));
      expect(summary).toContain("12,345");
    });
    it("labels list progress as village-target progress", () => {
      const markup = html(language, createElement(FundList, { statusFilter: null, funds: [{
        id: "f", name: "Fund", status: "ACTIVE", villageTargetAmount: 100_001,
        acceptedCollectionAmount: 100_001, startDate: fund.startDate.toISOString(), endDate: fund.endDate.toISOString(),
      }] }));
      expect(markup).toContain(t("funds.card.target"));
      expect(markup).toContain(t("funds.progress.label"));
      expect(markup).toContain(t("funds.summary.reached"));
      expect(markup).not.toContain(t("funds.metrics.complete"));
    });
  });
}
