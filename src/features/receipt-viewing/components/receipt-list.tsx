"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReceiptStatus } from "@prisma/client";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useTranslation } from "@/lib/i18n/provider";
import { cn, formatAmount, formatYangonDateTime } from "@/lib/utils";
import { ReceiptStatusBadge } from "./receipt-status-badge";

export interface ReceiptListItem {
  id: string;
  receiptNumber: string;
  status: ReceiptStatus;
  payment: {
    amount: number;
    paymentMethod: string;
    createdAt: Date;
    fund: {
      name: string;
    };
  };
}

export function ReceiptList({
  receipts,
  limit,
}: {
  receipts: ReceiptListItem[];
  /** The page's query limit; used only to explain that older receipts exist. */
  limit?: number;
}) {
  const { t } = useTranslation();

  if (receipts.length === 0) {
    return (
      <EmptyState
        description={t("receipts.list.emptyBody")}
        title={t("receipts.list.emptyTitle")}
      />
    );
  }

  const count = String(receipts.length);
  const summary = (
    receipts.length === 1
      ? t("receipts.list.countOne")
      : t("receipts.list.countOther")
  ).replace("{count}", count);
  const limited = limit !== undefined && receipts.length >= limit;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{summary}</p>

      <ul aria-label={t("receipts.list.aria")} className="space-y-3">
        {receipts.map((receipt) => {
          const voided = receipt.status === "VOIDED";

          return (
            <li key={receipt.id}>
              <Link
                className="block rounded-xl"
                href={`/village/receipts/${receipt.id}`}
              >
                <Card className="p-4 sm:p-5" interactive>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="break-all font-mono text-sm font-semibold">
                        {receipt.receiptNumber}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {receipt.payment.fund.name}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <p
                        className={cn(
                          "text-lg font-semibold leading-tight tabular-nums",
                          voided && "text-muted-foreground line-through",
                        )}
                      >
                        <span className="sr-only">
                          {t("receipts.field.amount")}:{" "}
                        </span>
                        {formatAmount(receipt.payment.amount)}
                      </p>
                      <ReceiptStatusBadge status={receipt.status} />
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
                    <p>
                      <time dateTime={receipt.payment.createdAt.toISOString()}>
                        {formatYangonDateTime(receipt.payment.createdAt)}
                      </time>
                      <span aria-hidden="true"> · </span>
                      Cash
                    </p>
                    <ChevronRight
                      aria-hidden
                      className="size-4 shrink-0 rtl:rotate-180"
                    />
                  </div>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>

      {limited ? (
        <p className="text-sm text-muted-foreground">
          {t("receipts.list.limitNote").replace("{count}", String(limit))}
        </p>
      ) : null}
    </div>
  );
}
