"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "@/lib/i18n/provider";
import { formatAmount } from "@/lib/utils";
import { ChartEmptyState } from "./chart-empty-state";

interface MonthlyData {
  label: string;
  amount: number;
  count: number;
}

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function CollectionTrendChart({ data }: { data: MonthlyData[] }) {
  const { t } = useTranslation();

  if (data.length === 0) {
    return <ChartEmptyState message={t("dashboard.chart.emptyCollection")} />;
  }

  return (
    <div>
      {/* The drawing is hidden from assistive tech; the table below carries
          the same data. */}
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart
            accessibilityLayer={false}
            data={data}
            margin={{ top: 5, right: 8, left: 0, bottom: 5 }}
          >
            <defs>
              <linearGradient
                id="collectionGradient"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor="var(--success)"
                  stopOpacity={0.3}
                />
                <stop offset="95%" stopColor="var(--success)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis
              axisLine={{ stroke: "var(--border-strong)" }}
              dataKey="label"
              interval="preserveStartEnd"
              minTickGap={24}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickFormatter={(value) => compact.format(Number(value))}
              tickLine={false}
              width={44}
            />
            <Tooltip
              contentStyle={{
                borderRadius: "12px",
                border: "1px solid var(--border-strong)",
                background: "var(--card)",
                color: "var(--card-foreground)",
                fontSize: "13px",
              }}
              formatter={(value) => [
                formatAmount(Number(value)),
                t("dashboard.chart.collected"),
              ]}
            />
            <Area
              dataKey="amount"
              fill="url(#collectionGradient)"
              stroke="var(--success)"
              strokeWidth={2.5}
              type="monotone"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{t("dashboard.charts.trendDesc")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("dashboard.chart.month")}</th>
            <th scope="col">{t("dashboard.chart.collected")}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{formatAmount(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
