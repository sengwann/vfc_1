import { requireSystemAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/ui/page-header";
import { AuditFiltersForm } from "@/features/audit/components/audit-filters-form";
import { AuditPagination } from "@/features/audit/components/audit-pagination";
import { PlatformAuditList } from "@/features/audit/components/platform-audit-list";
import {
  ACTION_TYPE_OPTIONS,
  ENTITY_TYPE_OPTIONS,
  getFirstString,
  parseAuditFilters,
  resolveSearchParams,
} from "@/features/audit/lib/audit-filters";
import { fillTemplate } from "@/features/audit/lib/audit-labels";
import { getPlatformAuditLogs } from "@/features/audit/lib/audit-queries";
import { getPlatformShellContext } from "@/features/shell/lib/shell-context";
import { getT } from "@/lib/i18n/translations";

export const metadata = {
  title: "Platform Audit | Village Fund Collection System",
};

export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams?: unknown;
}) {
  await requireSystemAdmin();
  const { language } = await getPlatformShellContext();
  const t = getT(language);

  const params = await resolveSearchParams(searchParams);
  const filters = parseAuditFilters(params);
  const { logs, total, totalPages } = await getPlatformAuditLogs({ filters });

  const rawActionType = getFirstString(params.actionType);
  const rawDateFrom = getFirstString(params.dateFrom);
  const rawDateTo = getFirstString(params.dateTo);

  const filterParams = new URLSearchParams();
  if (filters.actionType) {
    filterParams.set("actionType", filters.actionType);
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
        description={t("audit.platform.description")}
        title={t("audit.platform.title")}
      />

      <AuditFiltersForm
        actionTypeOptions={ACTION_TYPE_OPTIONS}
        basePath="/admin/audit"
        entityTypeOptions={ENTITY_TYPE_OPTIONS}
        entityTypesByAction={{}}
        initialActionType={rawActionType}
        initialDateFrom={rawDateFrom}
        initialDateTo={rawDateTo}
        initialEntityType=""
        showEntityTypeFilter={false}
      />

      {total > 0 ? (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {fillTemplate(t("audit.summary"), { total })}
        </p>
      ) : null}

      <PlatformAuditList
        hasActiveFilters={hasActiveFilters}
        language={language}
        logs={logs}
      />

      <AuditPagination
        basePath="/admin/audit"
        baseQuery={baseQuery}
        currentPage={filters.page}
        language={language}
        totalPages={totalPages}
      />
    </div>
  );
}
