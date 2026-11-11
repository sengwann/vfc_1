"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fill } from "@/features/analytics/components/fill";
import { useTranslation } from "@/lib/i18n/provider";
import { formatAmount } from "@/lib/utils";
import { getProgressPercent } from "../lib/fund-format";
import { FundProgressBar } from "./fund-progress-bar";

export function FundSummaryCard({
  targetAmount,
  collectedAmount,
  acceptedCount,
}: {
  targetAmount: number;
  collectedAmount: number;
  acceptedCount: number;
}) {
  const { t } = useTranslation();
  const percent = getProgressPercent(collectedAmount, targetAmount);
  const remaining = Math.max(targetAmount - collectedAmount, 0);
  const reached = targetAmount > 0 && collectedAmount >= targetAmount;

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("funds.summary.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {t("funds.summary.collected")}
          </p>
          <p className="text-3xl font-semibold tabular-nums tracking-tight">
            {formatAmount(collectedAmount)}
          </p>
          <p className="text-sm text-muted-foreground">
            {fill(t("funds.summary.ofTarget"), {
              target: formatAmount(targetAmount),
            })}
          </p>
        </div>

        <div className="space-y-2">
          <FundProgressBar
            label={t("funds.progress.label")}
            percent={percent}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold tabular-nums">
              {percent}%
            </span>
            {reached ? (
              <Badge dot variant="success">
                {t("funds.summary.reached")}
              </Badge>
            ) : null}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-4 border-t pt-4">
          <div className="space-y-1">
            <dt className="text-sm text-muted-foreground">
              {t("funds.summary.remaining")}
            </dt>
            <dd className="text-lg font-semibold tabular-nums">
              {formatAmount(remaining)}
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="text-sm text-muted-foreground">
              {t("funds.summary.accepted")}
            </dt>
            <dd className="text-lg font-semibold tabular-nums">
              {acceptedCount}
            </dd>
          </div>
        </dl>

        <p className="text-sm text-muted-foreground">
          {t("funds.summary.note")}
        </p>
      </CardContent>
    </Card>
  );
}
