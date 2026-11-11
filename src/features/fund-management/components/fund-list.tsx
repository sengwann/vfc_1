"use client";

import Link from "next/link";
import type { FundStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { fill } from "@/features/analytics/components/fill";
import type { TranslationKey } from "@/lib/i18n/en";
import { useTranslation } from "@/lib/i18n/provider";
import { formatAmount } from "@/lib/utils";
import { formatFundDate, getProgressPercent } from "../lib/fund-format";
import { FundProgressBar } from "./fund-progress-bar";
import { FundStatusBadge } from "./fund-status-badge";

export interface FundListItem {
  id: string;
  name: string;
  status: FundStatus;
  targetAmount: number;
  collectedAmount: number;
  /** ISO string */
  startDate: string;
  /** ISO string */
  endDate: string;
}

const FILTERS: {
  key: FundStatus | null;
  label: TranslationKey;
  href: string;
}[] = [
  { key: null, label: "funds.filter.all", href: "/village/funds" },
  {
    key: "DRAFT",
    label: "funds.status.draft",
    href: "/village/funds?status=DRAFT",
  },
  {
    key: "ACTIVE",
    label: "funds.status.active",
    href: "/village/funds?status=ACTIVE",
  },
  {
    key: "CLOSED",
    label: "funds.status.closed",
    href: "/village/funds?status=CLOSED",
  },
];

export function FundList({
  funds,
  statusFilter,
}: {
  funds: FundListItem[];
  statusFilter: FundStatus | null;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <Button asChild>
            <Link href="/village/funds/new">{t("funds.list.create")}</Link>
          </Button>
        }
        description={t("funds.list.description")}
        title={t("funds.list.title")}
      />

      <nav
        aria-label={t("funds.list.filterLabel")}
        className="flex flex-wrap gap-2"
      >
        {FILTERS.map((filter) => {
          const active = filter.key === statusFilter;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={buttonVariants({
                variant: active ? "default" : "outline",
                size: "sm",
              })}
              href={filter.href}
              key={filter.label}
            >
              {t(filter.label)}
            </Link>
          );
        })}
      </nav>

      {funds.length === 0 ? (
        statusFilter ? (
          <EmptyState
            action={
              <Button asChild variant="outline">
                <Link href="/village/funds">{t("funds.list.showAll")}</Link>
              </Button>
            }
            description={t("funds.list.noMatchBody")}
            title={t("funds.list.noMatchTitle")}
          />
        ) : (
          <EmptyState
            action={
              <Button asChild>
                <Link href="/village/funds/new">
                  {t("funds.list.emptyAction")}
                </Link>
              </Button>
            }
            description={t("funds.list.emptyBody")}
            title={t("funds.list.emptyTitle")}
          />
        )
      ) : (
        <div className="space-y-3">
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {fill(
              t(
                funds.length === 1
                  ? "funds.list.countOne"
                  : "funds.list.countOther",
              ),
              { count: funds.length },
            )}
          </p>

          <ul className="grid gap-3 lg:grid-cols-2">
            {funds.map((fund) => {
              const percent = getProgressPercent(
                fund.collectedAmount,
                fund.targetAmount,
              );
              const showProgress = fund.status !== "DRAFT";

              return (
                <li key={fund.id}>
                  <Link
                    className="block rounded-xl"
                    href={`/village/funds/${fund.id}`}
                  >
                    <Card className="h-full space-y-4 p-4 sm:p-5" interactive>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <h2 className="text-base font-semibold leading-snug">
                            {fund.name}
                          </h2>
                          <p className="text-sm text-muted-foreground">
                            {fill(t("funds.period"), {
                              start: formatFundDate(fund.startDate),
                              end: formatFundDate(fund.endDate),
                            })}
                          </p>
                        </div>
                        <FundStatusBadge status={fund.status} />
                      </div>

                      <dl className="grid grid-cols-2 gap-3">
                        <div className="space-y-0.5">
                          <dt className="text-xs text-muted-foreground">
                            {t("funds.card.collected")}
                          </dt>
                          <dd className="text-xl font-semibold tabular-nums">
                            {formatAmount(fund.collectedAmount)}
                          </dd>
                        </div>
                        <div className="space-y-0.5">
                          <dt className="text-xs text-muted-foreground">
                            {t("funds.card.target")}
                          </dt>
                          <dd className="text-xl font-semibold tabular-nums text-muted-foreground">
                            {formatAmount(fund.targetAmount)}
                          </dd>
                        </div>
                      </dl>

                      {showProgress ? (
                        <div className="space-y-1.5">
                          <FundProgressBar
                            className="h-2"
                            label={t("funds.progress.label")}
                            percent={percent}
                          />
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-muted-foreground">
                              {fill(t("funds.card.progress"), { percent })}
                            </span>
                            {percent >= 100 ? (
                              <Badge dot variant="success">
                                {t("funds.summary.reached")}
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </Card>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
