import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import { getT } from "@/lib/i18n/translations";
import { FundLifecycleHistoryPanel } from "./fund-lifecycle-history";
import type { FundLifecycleHistory } from "../lib/fund-lifecycle-history";
const date = new Date("2026-11-01T00:00:00Z");
function fixture(): FundLifecycleHistory {
  return { fund: { id: "f", villageId: "v", name: "Fund", description: null, villageTargetAmount: 1000, eligibleHouseCount: 1, assessmentPerHouse: 1000, snapshotAt: date,
    termsVersion: 4, closedAt: date, closedByUserId: "old-chief", closedBy: { id: "old-chief", name: "Current actor name" }, startDate: date, endDate: date, status: "CLOSED", createdAt: date, updatedAt: date },
    extensions: [{ id: "e", previousEndDate: "2026-10-31", newEndDate: "2026-11-01", previousTermsVersion: 2, newTermsVersion: 3, actorName: "Extension actor", changedAt: date.toISOString(), reason: "<script>unpaid</script>", evidenceWarning: true }],
    closureWarning: true, stale: false, older: "e" };
}
for (const language of ["EN", "MY"] as const) {
  describe(`lifecycle history ${language}`, () => {
    const render = (history: FundLifecycleHistory) => renderToStaticMarkup(createElement(TranslationProvider, { language }, createElement(FundLifecycleHistoryPanel, { history })));
    it("shows persisted facts, actor caveat, traceability and escaped reasons without mutation controls", () => {
      const html = render(fixture()); const t = getT(language);
      for (const key of ["funds.history.title", "funds.history.version", "funds.history.actorNote", "funds.history.evidenceWarning"] as const) expect(html).toContain(t(key));
      expect(html).toContain("Extension actor");
      expect(html).toContain("Current actor name"); expect(html).toContain("&lt;script&gt;unpaid&lt;/script&gt;");
      expect(html).toContain('/village/funds/f/audit'); expect(html).toContain('?before=e');
      expect(html).not.toContain("<form"); expect(html).not.toContain("<button");
    });
    it("shows the localized fallback when the closure actor is unavailable", () => {
      const value = fixture();
      value.fund.closedBy = null;
      const t = getT(language);
      const html = render(value);
      expect(html).toContain(`${t("audit.detail.actor")}: ${t("funds.history.actorUnavailable")}`);
      expect(html).toContain("Extension actor");
    });
    it("distinguishes not closed, no extensions and stale navigation", () => {
      const value = fixture(); value.fund.status = "DRAFT"; value.fund.closedAt = null; value.extensions = []; value.closureWarning = false;
      expect(render(value)).toContain(getT(language)("funds.history.notClosed")); expect(render(value)).toContain(getT(language)("funds.history.noExtensions"));
      value.stale = true; const html = render(value); expect(html).toContain(getT(language)("funds.history.stale")); expect(html).not.toContain(getT(language)("funds.history.noExtensions"));
    });
  });
}
