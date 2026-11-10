"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { useTranslation } from "@/lib/i18n/provider";
import { formatAmount } from "@/lib/utils";
import type { CollectorChartData } from "../lib/collector-analytics";
import { CollectionTrendChart } from "./collection-trend-chart";
import type { CollectorDashboardData } from "./dashboard-types";
import { fill } from "./fill";
import { StatCard } from "./stat-card";

export function CollectorOverview({
  data,
  period,
}: {
  data: CollectorDashboardData;
  period: { year: number; month: number };
}) {
  const { t } = useTranslation();
  const periodLabel = `${period.year}-${String(period.month).padStart(2, "0")}`;

  return (
    <Section
      description={fill(t("dashboard.collector.period"), {
        period: periodLabel,
      })}
      title={t("dashboard.collector.title")}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-2">
        <StatCard
          label={t("dashboard.collector.accepted")}
          tone="success"
          value={data.acceptedCount}
        />
        </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild className="w-full sm:w-auto" variant="outline">
          <Link href="/village/cash">{t("dashboard.collector.record")}</Link>
        </Button>
      </div>
    </Section>
  );
}

export function CollectorInsights({ data }: { data: CollectorChartData }) {
  const { t } = useTranslation();

  return (
    <Section title={t("dashboard.collector.summaryTitle")}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-2">
        <StatCard
          label={t("dashboard.collector.totalCollected")}
          tone="success"
          value={formatAmount(data.summary.totalCollected)}
        />
        <StatCard
          label={t("dashboard.collector.completed")}
          value={data.summary.acceptedCount}
        />
        </div>

      <div className="grid gap-3 lg:grid-cols-2">
        </div>
    </Section>
  );
}
