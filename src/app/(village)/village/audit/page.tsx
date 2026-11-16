import { requireChief } from "@/lib/authz";
import { PageHeader } from "@/components/ui/page-header";
import { AuditFiltersForm } from "@/features/audit/components/audit-filters-form";
import { AuditLogList } from "@/features/audit/components/audit-log-list";
import { AuditPagination } from "@/features/audit/components/audit-pagination";
import {
  ACTION_TYPE_OPTIONS,
  ENTITY_TYPE_OPTIONS,
  getFirstString,
  parseAuditFilters,
  resolveSearchParams,
  entityTypesByAction,
} from "@/features/audit/lib/audit-filters";
import { fillTemplate } from "@/features/audit/lib/audit-labels";
import { getChiefAuditLogs } from "@/features/audit/lib/audit-queries";
import { getVillageShellContext } from "@/features/shell/lib/shell-context";
import { getT } from "@/lib/i18n/translations";

export const metadata = {
  title: "Audit Log | Village Fund Collection System",
};

export default async function VillageAuditPage({
  searchParams,
}: {
  searchParams?: unknown;
}) {
  const { villageId } = await requireChief();
  const { language } = await getVillageShellContext();
  const t = getT(language);

  const params = await resolveSearchParams(searchParams);
  const filters = parseAuditFilters(params);
  const result = filters.dateRange.ok
    ? await getChiefAuditLogs({ villageId, filters }) : null;

  const rawActionType = getFirstString(params.actionType);
  const rawEntityType = getFirstString(params.entityType);
  const rawDateFrom = getFirstString(params.dateFrom);
  const rawDateTo = getFirstString(params.dateTo);

  const filterParams = new URLSearchParams();
  if (filters.actionType) {
    filterParams.set("actionType", filters.actionType);
  }
  if (filters.entityType) {
    filterParams.set("entityType", filters.entityType);
  }
  if (filters.dateRange.ok && filters.dateRange.from) {
    filterParams.set("dateFrom", filters.dateRange.from);
  }
  if (filters.dateRange.ok && filters.dateRange.to) {
    filterParams.set("dateTo", filters.dateRange.to);
  }
  const baseQuery = filterParams.toString();
  const hasActiveFilters = baseQuery !== "";

  return (
    <div className="space-y-6">
      <PageHeader
        description={t("audit.description")}
        title={t("audit.title")}
      />

      <AuditFiltersForm
        key={JSON.stringify([params.actionType, params.entityType, params.dateFrom, params.dateTo])}
        dateError={filters.dateRange.ok ? undefined : filters.dateRange.error}
        actionTypeOptions={ACTION_TYPE_OPTIONS}
        basePath="/village/audit"
        entityTypeOptions={ENTITY_TYPE_OPTIONS}
        entityTypesByAction={entityTypesByAction}
        initialActionType={rawActionType}
        initialDateFrom={rawDateFrom}
        initialDateTo={rawDateTo}
        initialEntityType={rawEntityType}
        showEntityTypeFilter={true}
      />

      {result ? (
        <>
          {result.total > 0 ? (
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {fillTemplate(t("audit.summary"), { total: result.total })}
            </p>
          ) : null}

          <AuditLogList
            basePath="/village/audit"
            hasActiveFilters={hasActiveFilters}
            language={language}
            logs={result.logs}
          />

          <AuditPagination
            basePath="/village/audit"
            baseQuery={baseQuery}
            currentPage={filters.page}
            language={language}
            totalPages={result.totalPages}
          />
        </>
      ) : null}
    </div>
  );
}
