import { notFound } from "next/navigation";
import { requireSystemAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/ui/page-header";
import { AuditActionBadge } from "@/features/audit/components/audit-action-badge";
import { AuditDetailCard } from "@/features/audit/components/audit-detail-card";
import { AuditEntityBadge } from "@/features/audit/components/audit-entity-badge";
import { extractRouteParam } from "@/features/audit/lib/audit-filters";
import {
  getActionLabel,
  getEntityLabel,
} from "@/features/audit/lib/audit-labels";
import { getPlatformAuditDetail } from "@/features/audit/lib/audit-queries";
import type { EntityLinkInfo } from "@/features/audit/lib/audit-entity-labels";
import { getPlatformShellContext } from "@/features/shell/lib/shell-context";
import { getT } from "@/lib/i18n/translations";

export const metadata = {
  title: "Platform Audit Detail | Village Fund Collection System",
};

export default async function PlatformAuditDetailPage({
  params,
}: {
  params: unknown;
}) {
  await requireSystemAdmin();
  const { language } = await getPlatformShellContext();
  const t = getT(language);

  const auditId = await extractRouteParam(params, "auditId");
  if (!auditId) {
    notFound();
  }

  const audit = await getPlatformAuditDetail({ auditId });
  if (!audit) {
    notFound();
  }

  const entityInfo: EntityLinkInfo = {
    label:
      audit.villageCode && audit.villageName
        ? `${audit.villageCode} — ${audit.villageName}`
        : (audit.entityId ?? "—"),
    href: audit.villageId ? `/admin/villages/${audit.villageId}` : null,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/admin/audit"
        backLabel={t("audit.platform.detail.back")}
        description={t("audit.platform.detail.description")}
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
        title={t("audit.platform.detail.title")}
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
