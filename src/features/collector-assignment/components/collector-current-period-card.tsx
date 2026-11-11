"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n/provider";
import { CollectorAssignmentStatusBadge } from "./collector-assignment-status-badge";
import { usePeriodLabel } from "./collector-period";

export function CollectorCurrentPeriodCard({
  year,
  month,
  collectorName,
}: {
  year: number;
  month: number;
  collectorName: string | null;
}) {
  const { t } = useTranslation();
  const formatPeriod = usePeriodLabel();

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("collectors.current.title")}
          </p>
          <CardTitle as="h2" className="text-lg">
            {formatPeriod(year, month)}
          </CardTitle>
        </div>
        {collectorName ? (
          <CollectorAssignmentStatusBadge isActive periodStatus="current" />
        ) : (
          <Badge className="shrink-0" dot variant="warning">
            {t("dashboard.unassigned")}
          </Badge>
        )}
      </CardHeader>

      <CardContent>
        {collectorName ? (
          <dl className="space-y-1">
            <dt className="text-xs text-muted-foreground">
              {t("collectors.current.activeCollector")}
            </dt>
            <dd className="break-words text-base font-semibold">
              {collectorName}
            </dd>
          </dl>
        ) : (
          <Alert tone="warning">
            <p>{t("shell.attention.noCollector")}</p>
            <div className="mt-3">
              <Button asChild size="sm" variant="outline">
                <a href="#assign-collector">
                  {t("collectors.current.assignNow")}
                </a>
              </Button>
            </div>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
