import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { AuditActionType, LanguagePreference } from "@prisma/client";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/lib/i18n/translations";
import { formatYangonDateTime } from "@/lib/utils";
import type { EntityLinkInfo } from "../lib/audit-entity-labels";
import {
  getActionLabel,
  getEntityLabel,
  getStatusLabel,
  getStatusTone,
  getStatusTransition,
} from "../lib/audit-labels";
import { AuditActionBadge } from "./audit-action-badge";
import { AuditEntityBadge } from "./audit-entity-badge";
import { AuditMetadataViewer } from "./audit-metadata-viewer";

export function AuditDetailCard({
  actionType,
  entityType,
  actorName,
  createdAt,
  entityInfo,
  metadata,
  language,
}: {
  actionType: AuditActionType;
  entityType: string;
  actorName: string | null;
  createdAt: Date;
  entityInfo: EntityLinkInfo;
  metadata: unknown;
  language: LanguagePreference;
}) {
  const t = getT(language);
  const transition = getStatusTransition(metadata);

  const rows: { label: string; value: ReactNode }[] = [
    {
      label: t("audit.detail.action"),
      value: (
        <AuditActionBadge
          actionType={actionType}
          label={getActionLabel(t, actionType)}
        />
      ),
    },
    {
      label: t("audit.detail.entityType"),
      value: (
        <AuditEntityBadge
          entityType={entityType}
          label={getEntityLabel(t, entityType)}
        />
      ),
    },
    {
      label: t("audit.detail.entity"),
      value: entityInfo.href ? (
        <Link
          className="inline-flex min-h-11 items-center underline underline-offset-2 transition-colors hover:text-primary"
          href={entityInfo.href}
        >
          {entityInfo.label}
        </Link>
      ) : (
        entityInfo.label
      ),
    },
    {
      label: t("audit.detail.actor"),
      value: actorName ?? t("audit.system"),
    },
    {
      label: t("audit.detail.timestamp"),
      value: (
        <time dateTime={createdAt.toISOString()}>
          {formatYangonDateTime(createdAt)}
        </time>
      ),
    },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <Card>
        <CardHeader className="pb-3 sm:pb-3">
          <CardTitle as="h2">{t("audit.detail.eventTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y text-sm">
            {rows.map((row) => (
              <div
                className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5"
                key={row.label}
              >
                <dt className="shrink-0 text-muted-foreground">{row.label}</dt>
                <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-3 sm:pb-3">
            <CardTitle as="h2">{t("audit.detail.detailsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {transition ? (
              <div className="space-y-2 border-b pb-4">
                <p className="text-sm text-muted-foreground">
                  {t("audit.detail.statusChange")}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge dot variant={getStatusTone(transition.previous)}>
                    {getStatusLabel(t, transition.previous)}
                  </Badge>
                  <ArrowRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
                  />
                  <Badge dot variant={getStatusTone(transition.next)}>
                    {getStatusLabel(t, transition.next)}
                  </Badge>
                </div>
              </div>
            ) : null}
            <AuditMetadataViewer language={language} metadata={metadata} />
          </CardContent>
        </Card>

        <Alert tone="info">{t("audit.detail.appendOnly")}</Alert>
      </div>
    </div>
  );
}
