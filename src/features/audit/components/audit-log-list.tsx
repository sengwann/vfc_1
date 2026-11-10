import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { LanguagePreference } from "@prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getT } from "@/lib/i18n/translations";
import type { AuditLogListItem } from "../lib/audit-queries";
import {
  fillTemplate,
  formatYangonTime,
  getActionLabel,
  getEntityLabel,
  groupByDay,
} from "../lib/audit-labels";
import { AuditActionBadge } from "./audit-action-badge";
import { AuditEntityBadge } from "./audit-entity-badge";

export function AuditLogList({
  logs,
  basePath,
  language,
  hasActiveFilters = false,
}: {
  logs: AuditLogListItem[];
  basePath: string;
  language: LanguagePreference;
  hasActiveFilters?: boolean;
}) {
  const t = getT(language);

  if (logs.length === 0) {
    return (
      <EmptyState
        action={
          hasActiveFilters ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              href={basePath}
            >
              {t("audit.filters.clear")}
            </Link>
          ) : null
        }
        description={
          hasActiveFilters ? t("audit.empty.body") : t("audit.empty.noneBody")
        }
        title={t("audit.empty.title")}
      />
    );
  }

  const groups = groupByDay(logs);

  return (
    <div aria-label={t("audit.list.label")} className="space-y-5" role="region">
      {groups.map((group, index) => (
        <section
          aria-labelledby={`audit-day-${index}`}
          className="space-y-2"
          key={group.key}
        >
          <h2
            className="px-1 text-xs font-semibold text-muted-foreground"
            id={`audit-day-${index}`}
          >
            {group.key}
          </h2>
          <Card className="overflow-hidden">
            <ul className="divide-y">
              {group.items.map((log) => (
                <li key={log.id}>
                  <Link
                    className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted sm:px-5"
                    href={`${basePath}/${log.id}`}
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <AuditActionBadge
                          actionType={log.actionType}
                          label={getActionLabel(t, log.actionType)}
                        />
                        <AuditEntityBadge
                          entityType={log.entityType}
                          label={getEntityLabel(t, log.entityType)}
                        />
                      </div>
                      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                        {fillTemplate(t("audit.by"), {
                          name: log.actorName ?? t("audit.system"),
                        })}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <time
                        className="text-xs tabular-nums text-muted-foreground"
                        dateTime={log.createdAt.toISOString()}
                      >
                        {formatYangonTime(log.createdAt)}
                      </time>
                      <ChevronRight
                        aria-hidden
                        className="size-4 text-muted-foreground rtl:rotate-180"
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ))}
    </div>
  );
}
