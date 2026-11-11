"use client";

import type { TranslationKey } from "@/lib/i18n/en";
import { useTranslation } from "@/lib/i18n/provider";
import { fill } from "./fill";
import { ChartEmptyState } from "./chart-empty-state";

interface AgeGroupData {
  group: string;
  count: number;
}

const LABELS: Record<string, TranslationKey> = {
  Children: "dashboard.age.children",
  Teenagers: "dashboard.age.teenagers",
  Adults: "dashboard.age.adults",
  Elderly: "dashboard.age.elderly",
  "Not set": "dashboard.age.notSet",
};

/* Bars are decorative: every row also states the group, count and percent. */
const BARS: Record<string, string> = {
  Children: "bg-info",
  Teenagers: "bg-warning",
  Adults: "bg-success",
  Elderly: "bg-secondary-foreground/70",
  "Not set": "bg-muted-foreground/50",
};

export function AgeGroupChart({ data }: { data: AgeGroupData[] }) {
  const { t } = useTranslation();
  const total = data.reduce((sum, item) => sum + item.count, 0);

  if (total === 0) {
    return <ChartEmptyState message={t("dashboard.chart.emptyMembers")} />;
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-3.5">
        {data.map((item) => {
          const pct = (item.count / total) * 100;
          const labelKey = LABELS[item.group];
          return (
            <li key={item.group}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 font-medium">
                  {labelKey ? t(labelKey) : item.group}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {item.count}
                  </span>{" "}
                  · {Math.round(pct)}%
                </span>
              </div>
              <div
                aria-hidden="true"
                className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={`h-full rounded-full ${BARS[item.group] ?? "bg-muted-foreground/50"}`}
                  style={{
                    width: item.count > 0 ? `${Math.max(pct, 2)}%` : "0%",
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-border pt-3 text-sm text-muted-foreground">
        {fill(t("dashboard.demo.total"), { count: total })}
      </p>
    </div>
  );
}
