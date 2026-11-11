"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/provider";
import { CollectorAssignmentStatusBadge } from "./collector-assignment-status-badge";
import { getPeriodStatus, usePeriodLabel } from "./collector-period";
import {
  DeactivateAssignmentControl,
  type DeactivateAssignmentAction,
} from "./deactivate-assignment-control";

export interface CollectorAssignmentListItem {
  id: string;
  year: number;
  month: number;
  isActive: boolean;
  collectorName: string;
  /** Already formatted on the server. */
  assignedAt: string;
  /** Result of canDeactivateAssignment(), computed on the server. */
  canDeactivate: boolean;
}

export function CollectorAssignmentList({
  assignments,
  currentPeriod,
  deactivateAction,
}: {
  assignments: CollectorAssignmentListItem[];
  currentPeriod: { year: number; month: number };
  deactivateAction: DeactivateAssignmentAction;
}) {
  const { t } = useTranslation();
  const formatPeriod = usePeriodLabel();

  return (
    <Section
      description={t("collectors.history.description")}
      id="assignment-history"
      title={t("collectors.history.title")}
    >
      {assignments.length === 0 ? (
        <EmptyState
          description={t("collectors.history.emptyBody")}
          title={t("collectors.history.emptyTitle")}
        />
      ) : (
        <ul aria-label={t("collectors.title")} className="space-y-3">
          {assignments.map((assignment) => {
            const periodLabel = formatPeriod(assignment.year, assignment.month);
            const periodStatus = getPeriodStatus(
              assignment.year,
              assignment.month,
              currentPeriod,
            );

            return (
              <li key={assignment.id}>
                <Card
                  className={cn(
                    "space-y-3 p-4",
                    periodStatus === "current" &&
                      assignment.isActive &&
                      "border-primary/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{periodLabel}</p>
                        {periodStatus === "current" ? (
                          <Badge variant="info">
                            {t("collectors.current.title")}
                          </Badge>
                        ) : null}
                        {periodStatus === "upcoming" ? (
                          <Badge variant="outline">
                            {t("collectors.period.upcoming")}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="break-words text-base font-medium">
                        {assignment.collectorName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("collectors.history.assigned").replace(
                          "{date}",
                          assignment.assignedAt,
                        )}
                      </p>
                    </div>
                    <CollectorAssignmentStatusBadge
                      isActive={assignment.isActive}
                      periodStatus={periodStatus}
                    />
                  </div>

                  {assignment.canDeactivate ? (
                    <DeactivateAssignmentControl
                      action={deactivateAction}
                      assignmentId={assignment.id}
                      collectorName={assignment.collectorName}
                      periodLabel={periodLabel}
                    />
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
