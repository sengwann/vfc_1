"use client";

import Link from "next/link";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import type { TranslationKey } from "@/lib/i18n/en";
import { useTranslation } from "@/lib/i18n/provider";
import { formatAmount, formatYangonDateTime } from "@/lib/utils";
import type { DashboardFund, VillagerDashboardData } from "./dashboard-types";
import { fill } from "./fill";

const STATUS: Record<string, { variant: BadgeVariant; key: TranslationKey }> = {
  ACCEPTED: { variant: "success", key: "dashboard.status.accepted" },
  VOIDED: { variant: "neutral", key: "cashPay.status.voided" },
};

export function VillagerOverview({
  fund,
  data,
}: {
  fund: DashboardFund | null;
  data: VillagerDashboardData;
}) {
  const { t } = useTranslation();
  const paymentStatusConfig = data.paymentStatus
    ? STATUS[data.paymentStatus]
    : null;

  return (
    <div className="space-y-6 sm:space-y-8">
      <Section title={t("dashboard.fund.title")}>
        {fund ? (
          <Card>
            <CardHeader className="pb-3 sm:pb-3">
              <CardTitle as="h3" className="break-words">
                {fund.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="divide-y divide-border text-sm">
                <div className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
                  <dt className="text-muted-foreground">
                    {t("dashboard.fund.targetAmount")}
                  </dt>
                  <dd className="text-right font-semibold tabular-nums">
                    {formatAmount(fund.targetAmount)}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3 py-2.5">
                  <dt className="text-muted-foreground">
                    {t("dashboard.fund.period")}
                  </dt>
                  <dd className="text-right">
                    {fill(t("dashboard.fund.dateRange"), {
                      start: formatYangonDateTime(fund.startDate, "date"),
                      end: formatYangonDateTime(fund.endDate, "date"),
                    })}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5 last:pb-0">
                  <dt className="text-muted-foreground">
                    {t("dashboard.fund.paymentStatus")}
                  </dt>
                  <dd>
                    {data.paymentStatus ? (
                      <Badge
                        dot
                        variant={paymentStatusConfig?.variant ?? "neutral"}
                      >
                        {paymentStatusConfig
                          ? t(paymentStatusConfig.key)
                          : data.paymentStatus}
                      </Badge>
                    ) : (
                      <Badge dot variant="neutral">
                        {t("dashboard.pay.notPaid")}
                      </Badge>
                    )}
                  </dd>
                </div>
              </dl>
              {!data.paymentStatus ? (
                <p className="text-sm text-muted-foreground">
                  {t("dashboard.pay.cashInfo")}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <EmptyState
            description={t("dashboard.fund.noneVillager")}
            title={t("dashboard.fund.noneTitle")}
          />
        )}
      </Section>

      <Section
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link href="/village/receipts">
              {fill(t("dashboard.recent.viewReceipts"), {
                count: data.receiptsCount,
              })}
            </Link>
          </Button>
        }
        title={t("dashboard.recent.title")}
      >
        {data.recentPayments.length === 0 ? (
          <EmptyState title={t("dashboard.recent.empty")} />
        ) : (
          <Card>
            <ul className="divide-y divide-border">
              {data.recentPayments.map((payment) => {
                const statusConfig = STATUS[payment.status];
                return (
                  <li
                    className="flex items-center justify-between gap-3 p-3.5 sm:p-4"
                    key={payment.id}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold tabular-nums">
                        {formatAmount(payment.amount)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Cash · {formatYangonDateTime(payment.createdAt)}
                      </p>
                    </div>
                    <Badge dot variant={statusConfig?.variant ?? "neutral"}>
                      {statusConfig ? t(statusConfig.key) : payment.status}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </Section>
    </div>
  );
}
