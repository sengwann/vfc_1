import { notFound } from "next/navigation";
import { requireChief } from "@/lib/authz";
import { getVillageShellContext } from "@/features/shell/lib/shell-context";
import { getT } from "@/lib/i18n/translations";
import { AuditFiltersForm } from "@/features/audit/components/audit-filters-form";
import { AuditLogList } from "@/features/audit/components/audit-log-list";
import { AuditPagination } from "@/features/audit/components/audit-pagination";
import { ACTION_TYPE_OPTIONS, getFirstString, parseAuditFilters, resolveSearchParams } from "@/features/audit/lib/audit-filters";
import { getChiefFundAuditLogs } from "@/features/audit/lib/audit-queries";
import { withChiefFundHistorySnapshot } from "@/features/fund-management/lib/fund-lifecycle-history";

const entities = ["FUND", "FUND_END_DATE_EXTENSION", "FUND_HOUSE_ASSESSMENT", "PAYMENT", "RECEIPT"];
export default async function FundAuditPage({ params, searchParams }: { params: unknown; searchParams?: unknown }) {
  await requireChief();
  const route = await params as { fundId?: unknown };
  if (typeof route?.fundId !== "string") notFound();
  const fundId = route.fundId;
  const raw = await resolveSearchParams(searchParams);
  const filters = parseAuditFilters(raw);
  // Validate Fund ownership even when a bad date prevents audit data queries.
  const result = filters.dateRange.ok ? await getChiefFundAuditLogs(fundId, filters) : null;
  const fund = result?.fund ?? await withChiefFundHistorySnapshot(fundId, async (_tx, value) => ({ id: value.id, name: value.name }));
  const { language } = await getVillageShellContext();
  const t = getT(language);
  const base = `/village/funds/${encodeURIComponent(fund.id)}/audit`;
  const query = new URLSearchParams();
  if (filters.actionType) query.set("actionType", filters.actionType);
  if (filters.entityType) query.set("entityType", filters.entityType);
  if (filters.dateRange.ok) {
    if (filters.dateRange.from) query.set("dateFrom", filters.dateRange.from);
    if (filters.dateRange.to) query.set("dateTo", filters.dateRange.to);
  }
  return <div className="space-y-6">
    <h1 className="text-2xl font-semibold">{t("funds.history.audit")}: {fund.name}</h1>
    <a href={`/village/funds/${encodeURIComponent(fund.id)}`}>{t("funds.history.back")}</a>
    <p>{t("funds.history.actorNote")}</p>
    <AuditFiltersForm key={JSON.stringify(raw)} basePath={base} actionTypeOptions={ACTION_TYPE_OPTIONS} entityTypeOptions={entities} entityTypesByAction={{}}
      initialActionType={getFirstString(raw.actionType)} initialEntityType={getFirstString(raw.entityType)} initialDateFrom={getFirstString(raw.dateFrom)} initialDateTo={getFirstString(raw.dateTo)}
      showEntityTypeFilter dateError={filters.dateRange.ok ? undefined : filters.dateRange.error} />
    {result ? <>
      <AuditLogList logs={result.logs} basePath={base} detailBasePath="/village/audit" language={language} hasActiveFilters={Boolean(query.size)} />
      <AuditPagination basePath={base} baseQuery={query.toString()} currentPage={filters.page} totalPages={result.totalPages} language={language} />
    </> : null}
  </div>;
}
