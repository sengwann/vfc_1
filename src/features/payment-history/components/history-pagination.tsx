"use client";
import { useTranslation } from "@/lib/i18n/provider";
export function HistoryPagination({ basePath, baseQuery, older, newer }: {
  basePath: string; baseQuery: string; older: string | null; newer: string | null;
}) {
  const { t } = useTranslation();
  const href = (cursor?: string, direction?: string) => {
    const query = new URLSearchParams(baseQuery);
    if (cursor && direction) { query.set("cursor", cursor); query.set("direction", direction); }
    return `${basePath}${query.size ? `?${query}` : ""}`;
  };
  return <nav aria-label={t("history.navigation")} className="flex flex-wrap gap-4">
    {newer ? <a href={href(newer, "newer")}>{t("history.newer")}</a> : null}
    <a href={href()}>{t("history.first")}</a>
    {older ? <a href={href(older, "older")}>{t("history.older")}</a> : null}
  </nav>;
}
