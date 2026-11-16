"use client";
import { useTranslation } from "@/lib/i18n/provider";
import type { FundReconciliationResult } from "../lib/fund-reconciliation-types";
import { FundSummaryCard } from "./fund-summary-card";
export function FundReconciliationView({ result, page, totalFindings }: { result: FundReconciliationResult; page: number; totalFindings: number }) {
  const { t } = useTranslation();
  const base = `/village/funds/${encodeURIComponent(result.fund.id)}`;
  return <div className="space-y-5">
    <h1 className="text-2xl font-semibold">{t("reconciliation.title")}: {result.fund.name}</h1>
    <p>{t("funds.history.version")}: {result.fund.termsVersion}</p>
    <p>{t("reconciliation.scope")}</p>
    <nav className="flex gap-4"><a href={base}>{t("funds.history.back")}</a><a href={`${base}/audit`}>{t("funds.history.audit")}</a></nav>
    <p role="status">{t(result.clean ? "reconciliation.clean" : "reconciliation.attention")}</p>
    <dl>{Object.entries(result.checks).map(([category, outcome]) => <div key={category}><dt>{t(category === "assessments" ? "reconciliation.assessments" : category === "payments" ? "reconciliation.payments" : category === "receipts" ? "reconciliation.receipts" : category === "lifecycle" ? "reconciliation.lifecycle" : "reconciliation.audit")}</dt><dd>{t(outcome === "PASS" ? "reconciliation.pass" : outcome === "DISCREPANCY" ? "reconciliation.discrepancy" : outcome === "UNVERIFIED" ? "reconciliation.unverified" : "reconciliation.notApplicable")}</dd></div>)}</dl>
    {result.checks.audit !== "PASS" ? <p role="alert">{t("reconciliation.auditWarning")}</p> : null}
    {result.metrics ? <FundSummaryCard metrics={result.metrics} /> : <p>{t("reconciliation.metricsUnavailable")}</p>}
    <p>{t("reconciliation.findings")}: {totalFindings}</p>
    <ol className="space-y-3">{result.findings.map((finding, index) => <li className="break-words rounded border p-3" key={`${finding.code}:${finding.recordId}:${index}`}>
      <p>{finding.code}: {t(finding.code === "CALCULATION_UNAVAILABLE" ? "reconciliation.calculationUnavailableDetail" : finding.code === "INPUT_INCOMPLETE" ? "reconciliation.incompleteDetail" : finding.code === "ACTOR_UNAVAILABLE" ? "funds.history.actorUnavailable" : (finding.code.startsWith("AUDIT_") || finding.code === "CREATION_ACTOR_CONFLICT") ? "reconciliation.auditDetail" : finding.code.startsWith("REPLACEMENT_") ? "reconciliation.replacementDetail" : finding.category === "assessments" ? "reconciliation.assessmentDetail" : finding.category === "payments" ? "reconciliation.paymentDetail" : finding.category === "receipts" ? "reconciliation.receiptDetail" : "reconciliation.lifecycleDetail")}</p>
      <p>{t(finding.outcome === "UNVERIFIED" ? "reconciliation.unverified" : "reconciliation.discrepancy")}</p>
      {finding.recordId ? <p>{t("reconciliation.record")}: {finding.recordId}</p> : null}
      {finding.expected !== undefined ? <p>{t("reconciliation.expected")}: {finding.expected}</p> : null}
      {finding.observed !== undefined ? <p>{t("reconciliation.observed")}: {finding.observed}</p> : null}
    </li>)}</ol>
    <nav className="flex gap-4" aria-label={t("reconciliation.findings")}>
      {page > 1 ? <a href={`${base}/reconciliation?page=${page - 1}`}>{t("history.newer")}</a> : null}
      {page * 100 < totalFindings ? <a href={`${base}/reconciliation?page=${page + 1}`}>{t("history.older")}</a> : null}
    </nav>
  </div>;
}
