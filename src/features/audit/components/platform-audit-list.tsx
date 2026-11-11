import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { LanguagePreference } from "@prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getT } from "@/lib/i18n/translations";
import type { PlatformAuditLogListItem } from "../lib/audit-queries";
import {
  fillTemplate,
  formatYangonTime,
  getActionLabel,
  groupByDay,
} from "../lib/audit-labels";
import { AuditActionBadge } from "./audit-action-badge";

export function PlatformAuditList({
  logs,
  language,
  hasActiveFilters = false,
}: {
  logs: PlatformAuditLogListItem[];
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
              href="/admin/audit"
            >
              {t("audit.filters.clear")}
            </Link>
          ) : null
        }
        description={
          hasActiveFilters
            ? t("audit.platform.empty.body")
            : t("audit.platform.empty.noneBody")
        }
        title={t("audit.platform.empty.title")}
      />
    );
  }

  const groups = groupByDay(logs);

  return (
    <div aria-label={t("audit.list.label")} className="space-y-5" role="region">
      {groups.map((group, index) => (
        <section
          aria-labelledby={`platform-audit-day-${index}`}
          className="space-y-2"
          key={group.key}
        >
          <h2
            className="px-1 text-xs font-semibold text-muted-foreground"
            id={`platform-audit-day-${index}`}
          >
            {group.key}
          </h2>
          <Card className="overflow-hidden">
            <ul className="divide-y">
              {group.items.map((log) => (
                <li key={log.id}>
                  <Link
                    className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted sm:px-5"
                    href={`/admin/audit/${log.id}`}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                        <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                          {log.villageCode ?? t("audit.entity.village")}
                        </p>
                        <AuditActionBadge
                          actionType={log.actionType}
                          label={getActionLabel(t, log.actionType)}
                        />
                      </div>
                      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                        {log.villageName ?? "—"}
                      </p>
                      <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {fillTemplate(t("audit.by"), {
                          name: log.actorName ?? t("audit.system"),
                        })}
                        {" · "}
                        <time
                          className="tabular-nums"
                          dateTime={log.createdAt.toISOString()}
                        >
                          {formatYangonTime(log.createdAt)}
                        </time>
                      </p>
                    </div>
                    <ChevronRight
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
                    />
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
