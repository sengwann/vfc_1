import { notFound } from "next/navigation";
import { requireChief } from "@/lib/authz";
import { PageHeader } from "@/components/ui/page-header";
import { AuditActionBadge } from "@/features/audit/components/audit-action-badge";
import { AuditDetailCard } from "@/features/audit/components/audit-detail-card";
import { AuditEntityBadge } from "@/features/audit/components/audit-entity-badge";
import { resolveEntityInfo } from "@/features/audit/lib/audit-entity-labels";
import { extractRouteParam } from "@/features/audit/lib/audit-filters";
import {
  getActionLabel,
  getEntityLabel,
} from "@/features/audit/lib/audit-labels";
import { getChiefAuditDetail } from "@/features/audit/lib/audit-queries";
import { getVillageShellContext } from "@/features/shell/lib/shell-context";
import { getT } from "@/lib/i18n/translations";

export const metadata = {
  title: "Audit Detail | Village Fund Collection System",
};

export default async function VillageAuditDetailPage({
  params,
}: {
  params: unknown;
}) {
  const { villageId } = await requireChief();
  const { language } = await getVillageShellContext();
  const t = getT(language);

  const auditId = await extractRouteParam(params, "auditId");
  if (!auditId) {
    notFound();
  }

  const audit = await getChiefAuditDetail({ auditId, villageId });
  if (!audit) {
    notFound();
  }

  const entityInfo = await resolveEntityInfo(
    audit.entityType,
    audit.entityId,
    villageId,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/village/audit"
        backLabel={t("audit.detail.back")}
        description={t("audit.detail.description")}
        meta={
          <>
            <AuditActionBadge
              actionType={audit.actionType}
              label={getActionLabel(t, audit.actionType)}
            />
            <AuditEntityBadge
              entityType={audit.entityType}
              label={getEntityLabel(t, audit.entityType)}
            />
          </>
        }
        title={t("audit.detail.title")}
      />

      <AuditDetailCard
        actionType={audit.actionType}
        actorName={audit.actorName}
        createdAt={audit.createdAt}
        entityInfo={entityInfo}
        entityType={audit.entityType}
        language={language}
        metadata={audit.metadata}
      />
    </div>
  );
}
