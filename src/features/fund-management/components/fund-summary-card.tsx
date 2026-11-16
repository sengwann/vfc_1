"use client";

import type { FundReportingMetrics } from "../lib/fund-reporting";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n/provider";
import { formatAmount } from "@/lib/utils";
import { getProgressPercent } from "../lib/fund-format";
import { FundProgressBar } from "./fund-progress-bar";

export function FundSummaryCard({ metrics }: { metrics: FundReportingMetrics }) {
  const { t } = useTranslation();
  const percent = getProgressPercent(metrics.acceptedCollectionAmount, metrics.villageTargetAmount);
  const money = (value: number | null) => value === null ? t("funds.metrics.notFrozen") : formatAmount(value);
  return (
    <Card>
      <CardHeader><CardTitle as="h2">{t("funds.summary.title")}</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {([
            ["funds.metrics.villageTarget", metrics.villageTargetAmount],
            ["funds.metrics.expected", metrics.expectedHouseholdAssessmentTotal],
            ["funds.metrics.rounding", metrics.roundingSurplus],
            ["funds.metrics.accepted", metrics.acceptedCollectionAmount],
            ["funds.metrics.outstanding", metrics.outstandingHouseholdObligations],
            ["funds.metrics.remainingTarget", metrics.remainingVillageTarget],
            ["funds.metrics.excess", metrics.excessCollectionOverVillageTarget],
          ] as const).map(([key, value]) => (
            <div className="space-y-1" key={key}>
              <dt className="text-sm text-muted-foreground">{t(key)}</dt>
              <dd className="text-lg font-semibold tabular-nums">{money(value)}</dd>
            </div>
          ))}
          <div><dt>{t("funds.metrics.paid")}</dt><dd>{metrics.paidFrozenAssessmentCount ?? t("funds.metrics.notFrozen")}</dd></div>
          <div><dt>{t("funds.metrics.unpaid")}</dt><dd>{metrics.unpaidFrozenAssessmentCount ?? t("funds.metrics.notFrozen")}</dd></div>
        </dl>
        {metrics.hasFrozenAssessments ? (
          <div className="space-y-2">
            <FundProgressBar label={t("funds.progress.label")} percent={percent} />
            <p className="text-sm tabular-nums">{t("funds.progress.label")}: {percent}%</p>
            {metrics.remainingVillageTarget === 0 ? <Badge variant="success">{t("funds.summary.reached")}</Badge> : null}
            <p>{t(metrics.isComplete ? "funds.metrics.complete" : "funds.metrics.incomplete")}</p>
            <p className="text-sm text-muted-foreground">{t("funds.metrics.coverageNote")}</p>
          </div>
        ) : <p className="text-sm text-muted-foreground">{t("funds.metrics.draftNote")}</p>}
      </CardContent>
    </Card>
  );
}
