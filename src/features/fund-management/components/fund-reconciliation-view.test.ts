import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";
import { getT } from "@/lib/i18n/translations";
import { FundReconciliationView } from "./fund-reconciliation-view";
import type { FundReconciliationResult } from "../lib/fund-reconciliation-types";
for (const language of ["EN", "MY"] as const) {
  it(`shows localized uncertainty and escaped findings without mutation controls in ${language}`, () => {
    const result: FundReconciliationResult = { fund: { id: "f", name: "Fund", termsVersion: 2 }, clean: false, metrics: null, checks: { assessments: "PASS", payments: "DISCREPANCY", receipts: "PASS", lifecycle: "NOT_APPLICABLE", audit: "UNVERIFIED" }, findings: [{ category: "audit", code: "INPUT_INCOMPLETE", outcome: "UNVERIFIED", recordId: "<script>bad</script>" }] };
    const html = renderToStaticMarkup(createElement(TranslationProvider, { language }, createElement(FundReconciliationView, { result, page: 1, totalFindings: 101 })));
    const t = getT(language);
    for (const key of ["reconciliation.title", "reconciliation.unverified", "reconciliation.metricsUnavailable", "reconciliation.auditWarning", "reconciliation.incompleteDetail"] as const) expect(html).toContain(t(key));
    expect(html).toContain("&lt;script&gt;bad&lt;/script&gt;"); expect(html).toContain("/village/funds/f/audit"); expect(html).toContain("reconciliation?page=2"); expect(html).not.toContain("<form");
  });
}

for (const language of ["EN", "MY"] as const) {
  it(`explains unavailable activation-total verification accurately in ${language}`, () => {
    const result: FundReconciliationResult = { fund: { id: "f", name: "Fund", termsVersion: 2 }, clean: false, metrics: null,
      checks: { assessments: "UNVERIFIED", payments: "UNVERIFIED", receipts: "PASS", lifecycle: "PASS", audit: "UNVERIFIED" },
      findings: [{ category: "audit", code: "CALCULATION_UNAVAILABLE", outcome: "UNVERIFIED", recordId: "f" }] };
    const html = renderToStaticMarkup(createElement(TranslationProvider, { language }, createElement(FundReconciliationView, { result, page: 1, totalFindings: 1 })));
    const t = getT(language);
    expect(html).toContain("CALCULATION_UNAVAILABLE");
    expect(html).toContain(t("reconciliation.calculationUnavailableDetail"));
    expect(html).not.toContain(t("reconciliation.lifecycleDetail"));
  });
}
