"use client";
import type { ReactNode } from "react";
import { useTranslation } from "@/lib/i18n/provider";
import type { HistoryParams } from "../lib/history-filters";
import type { HistoryResult } from "../lib/history-queries";
import { HistoryFiltersForm } from "./history-filters-form";
import { HistoryPagination } from "./history-pagination";
export function HistoryPanel({ result, params, basePath, children }: {
  result: HistoryResult; params: HistoryParams; basePath: string; children: ReactNode;
}) {
  const { t } = useTranslation();
  const errorKey = result.ok ? null : result.error === "STALE" || result.error === "CURSOR" ? "history.stale"
    : result.error === "UNAVAILABLE" ? "history.unavailable" : result.error === "DATE" ? "audit.filters.dateInvalid"
      : result.error === "REVERSED" ? "audit.filters.dateReversed" : result.error === "REPEATED" ? "history.repeated" : "history.invalid";
  return <div className="space-y-4">
    <HistoryFiltersForm key={JSON.stringify(params)} basePath={basePath} params={params} funds={result.funds} invalid={!result.ok} />
    {errorKey ? <div role="alert"><p>{t(errorKey)}</p><a href={basePath}>{t("history.restart")}</a></div> : null}
    {result.ok ? <>{children}<HistoryPagination basePath={basePath} baseQuery={result.baseQuery} older={result.older} newer={result.newer} /></> : null}
  </div>;
}
