"use client";
import { useTranslation } from "@/lib/i18n/provider";
import { formatYangonDateTime } from "@/lib/utils";
import { formatFundDate } from "../lib/fund-format";
import type { FundLifecycleHistory } from "../lib/fund-lifecycle-history";

export function FundLifecycleHistoryPanel({ history }: { history: FundLifecycleHistory }) {
  const { t } = useTranslation();
  const { fund } = history;
  const base = `/village/funds/${encodeURIComponent(fund.id)}`;
  return <section className="space-y-4 rounded-lg border p-4" aria-label={t("funds.history.title")}>
    <h2 className="text-lg font-semibold">{t("funds.history.title")}</h2>
    <p>{t("funds.history.version")}: {fund.termsVersion}</p>
    <p className="text-sm text-muted-foreground">{t("funds.history.actorNote")}</p>
    <a className="underline" href={`${base}/audit`}>{t("funds.history.audit")}</a>
    <h3>{t("funds.history.closure")}</h3>
    {fund.status === "CLOSED" ? <div>
      <p>{t("audit.detail.actor")}: {fund.closedBy?.name ?? t("funds.history.actorUnavailable")}</p>
      <p>{fund.closedAt ? formatYangonDateTime(fund.closedAt) : t("funds.history.missing")}</p>
      {history.closureWarning ? <p role="status">{t("funds.history.evidenceWarning")}</p> : null}
    </div> : <p>{t("funds.history.notClosed")}</p>}
    <h3>{t("funds.history.extensions")}</h3>
    {history.stale ? <p role="alert">{t("funds.history.stale")}</p> : history.extensions.length ? <ol className="space-y-4">{history.extensions.map((row) => <li key={row.id} className="border-t pt-3">
      <p>{t("funds.history.dates")}: {formatFundDate(row.previousEndDate)} → {formatFundDate(row.newEndDate)}</p>
      <p>{t("funds.history.version")}: {row.previousTermsVersion} → {row.newTermsVersion}</p>
      <p>{t("audit.detail.actor")}: {row.actorName ?? t("funds.history.actorUnavailable")}</p>
      <time dateTime={row.changedAt}>{formatYangonDateTime(new Date(row.changedAt))}</time>
      <p className="whitespace-pre-wrap break-words">{t("audit.meta.reason")}: {row.reason}</p>
      {row.evidenceWarning ? <p role="status">{t("funds.history.evidenceWarning")}</p> : null}
    </li>)}</ol> : <p>{t("funds.history.noExtensions")}</p>}
    <nav className="flex gap-4" aria-label={t("funds.history.title")}>
      <a href={base}>{t("history.first")}</a>
      {history.older ? <a href={`${base}?before=${encodeURIComponent(history.older)}`}>{t("history.older")}</a> : null}
    </nav>
  </section>;
}
