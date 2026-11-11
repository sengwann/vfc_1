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
  const { logs, total, totalPages } = await getChiefAuditLogs({
    villageId,
    filters,
  });

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
  if (rawDateFrom) {
    filterParams.set("dateFrom", rawDateFrom);
  }
  if (rawDateTo) {
    filterParams.set("dateTo", rawDateTo);
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

      {total > 0 ? (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {fillTemplate(t("audit.summary"), { total })}
        </p>
      ) : null}

      <AuditLogList
        basePath="/village/audit"
        hasActiveFilters={hasActiveFilters}
        language={language}
        logs={logs}
      />

      <AuditPagination
        basePath="/village/audit"
        baseQuery={baseQuery}
        currentPage={filters.page}
        language={language}
        totalPages={totalPages}
      />
    </div>
  );
}
