"use client";

import type { ReactNode } from "react";
import type { FundStatus } from "@prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { fill } from "@/features/analytics/components/fill";
import { useTranslation } from "@/lib/i18n/provider";
import { formatFundDate } from "../lib/fund-format";
import { FundStatusBadge } from "./fund-status-badge";
import { FundSummaryCard } from "./fund-summary-card";

export interface FundDetailData {
  id: string;
  name: string;
  description: string | null;
  status: FundStatus;
  targetAmount: number;
  /** ISO strings */
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b py-3 first:pt-0 last:border-b-0 last:pb-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

export function FundDetailView({
  fund,
  collectedAmount,
  acceptedCount,
  lifecycle,
  paymentSearch,
}: {
  fund: FundDetailData;
  collectedAmount: number;
  acceptedCount: number;
  /** Server-rendered lifecycle actions. */
  lifecycle: ReactNode;
  /** Payment status search, or null for draft funds. */
  paymentSearch: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/village/funds"
        backLabel={t("funds.back")}
        description={fill(t("funds.period"), {
          start: formatFundDate(fund.startDate),
          end: formatFundDate(fund.endDate),
        })}
        meta={<FundStatusBadge status={fund.status} />}
        title={fund.name}
      />

      <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
        <div className="space-y-4 lg:col-span-2">
          <FundSummaryCard
            acceptedCount={acceptedCount}
            collectedAmount={collectedAmount}
            targetAmount={fund.targetAmount}
          />
          {paymentSearch}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle as="h2">{t("funds.lifecycle.title")}</CardTitle>
            </CardHeader>
            <CardContent>{lifecycle}</CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h2">{t("funds.info.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl>
                <InfoRow
                  label={t("funds.info.start")}
                  value={formatFundDate(fund.startDate)}
                />
                <InfoRow
                  label={t("funds.info.end")}
                  value={formatFundDate(fund.endDate)}
                />
                <InfoRow
                  label={t("funds.info.created")}
                  value={formatFundDate(fund.createdAt)}
                />
                <InfoRow
                  label={t("funds.info.updated")}
                  value={formatFundDate(fund.updatedAt)}
                />
              </dl>
              <div className="space-y-1.5 border-t pt-4">
                <h3 className="text-sm font-semibold">
                  {t("funds.info.description")}
                </h3>
                <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
                  {fund.description ?? t("funds.info.noDescription")}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
