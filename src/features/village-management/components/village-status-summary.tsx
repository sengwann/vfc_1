import { VillageStatus } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatAmount } from "@/lib/utils";

const ORDER: VillageStatus[] = [
  VillageStatus.ACTIVE,
  VillageStatus.SUSPENDED,
  VillageStatus.DEACTIVATED,
];

const FILL_BY_STATUS: Record<VillageStatus, string> = {
  [VillageStatus.ACTIVE]: "bg-success",
  [VillageStatus.SUSPENDED]: "bg-warning",
  [VillageStatus.DEACTIVATED]: "bg-muted-foreground",
};

/*
 * Presentation only: receives counts already loaded by the page. The bar is
 * decorative (role="img" with a text summary); the legend rows carry the same
 * numbers as text, so colour is never the only signal.
 */
export function VillageStatusSummary({
  total,
  counts,
  title,
  totalLabel,
  statusLabels,
  chartLabel,
  className,
}: {
  total: number;
  counts: Record<VillageStatus, number>;
  title: string;
  totalLabel: string;
  statusLabels: Record<VillageStatus, string>;
  chartLabel: string;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-3 sm:pb-3">
        <CardTitle as="h2" className="text-sm text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <p className="text-4xl font-semibold leading-none tracking-tight tabular-nums">
            {formatAmount(total)}
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">{totalLabel}</p>
        </div>

        <div
          aria-label={chartLabel}
          className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
          role="img"
        >
          {total > 0
            ? ORDER.filter((status) => counts[status] > 0).map((status) => (
                <div
                  className={cn("h-full", FILL_BY_STATUS[status])}
                  key={status}
                  style={{ width: `${(counts[status] / total) * 100}%` }}
                />
              ))
            : null}
        </div>

        <dl className="divide-y">
          {ORDER.map((status) => {
            const percent =
              total > 0 ? Math.round((counts[status] / total) * 100) : 0;
            return (
              <div
                className="flex min-h-11 items-center gap-3 py-2"
                key={status}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2.5 shrink-0 rounded-full",
                    FILL_BY_STATUS[status],
                  )}
                />
                <dt className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
                  {statusLabels[status]}
                </dt>
                <dd className="flex shrink-0 items-baseline gap-2 tabular-nums">
                  <span className="text-base font-semibold">
                    {formatAmount(counts[status])}
                  </span>
                  <span className="w-10 text-right text-xs text-muted-foreground">
                    {percent}%
                  </span>
                </dd>
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}
