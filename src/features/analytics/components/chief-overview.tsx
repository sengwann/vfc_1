"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { useTranslation } from "@/lib/i18n/provider";
import { formatAmount, formatYangonDateTime } from "@/lib/utils";
import { AgeGroupChart } from "./age-group-chart";
import type {
  ChiefDashboardData,
  ChiefDemographicsData,
  DashboardFund,
} from "./dashboard-types";
import { fill } from "./fill";
import { StatCard } from "./stat-card";

export function ChiefOverview({
  data,
  fund,
}: {
  data: ChiefDashboardData;
  fund: DashboardFund | null;
}) {
  const { t } = useTranslation();

  return (
    <Section title={t("dashboard.chief.title")}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label={t("dashboard.stat.houses")} value={data.totalHouses} />
        <StatCard
          label={t("dashboard.stat.members")}
          value={data.totalMembers}
        />
        <StatCard
          className="col-span-2 lg:col-span-1"
          compact
          label={t("dashboard.stat.currentCollector")}
          value={data.currentCollectorName ?? t("dashboard.unassigned")}
        />
      </div>

      {fund ? (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 pb-3 sm:pb-3">
            <CardTitle as="h3">{t("dashboard.fund.title")}</CardTitle>
            <Button asChild size="sm" variant="outline">
              <Link href={`/village/funds/${fund.id}`}>
                {t("dashboard.fund.viewDetail")}
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="min-w-0">
              <p className="text-base font-semibold break-words">{fund.name}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {fill(t("dashboard.fund.dateRange"), {
                  start: formatYangonDateTime(fund.startDate, "date"),
                  end: formatYangonDateTime(fund.endDate, "date"),
                })}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/60 p-3">
                <dt className="text-sm text-muted-foreground">
                  {t("dashboard.fund.target")}
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">
                  {formatAmount(fund.targetAmount)}
                </dd>
              </div>
              <div className="rounded-lg bg-success-soft p-3">
                <dt className="text-sm text-success-strong">
                  {t("dashboard.fund.collected")}
                </dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-success-strong">
                  {formatAmount(data.totalCollected)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/village/funds">{t("dashboard.fund.goFunds")}</Link>
            </Button>
          }
          description={t("dashboard.fund.noneChief")}
          title={t("dashboard.fund.noneTitle")}
        />
      )}
    </Section>
  );
}

export function ChiefDemographics({ data }: { data: ChiefDemographicsData }) {
  const { t } = useTranslation();
  return (
    <Section
      description={t("dashboard.demo.desc")}
      title={t("dashboard.demo.title")}
    >
      <Card>
        <CardContent>
          <AgeGroupChart data={data.ageGroups} />
        </CardContent>
      </Card>
    </Section>
  );
}
