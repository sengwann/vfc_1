"use client";

import type { PaymentStatus, FundStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useTranslation } from "@/lib/i18n/provider";
import { cn, formatAmount, formatYangonDateTime } from "@/lib/utils";
import { formatMessage } from "./format-message";
import { VoidPaymentForm } from "./void-payment-form";

export interface CashPaymentListItem {
  id: string;
  amount: number;
  status: PaymentStatus;
  createdAt: Date;
  voidReason: string | null;
  assessment: {
    houseNumberSnapshot: string;
  };
  fund: { status: FundStatus };
  payer: {
    name: string;
  };
}

export function CashPaymentList({
  payments,
}: {
  payments: CashPaymentListItem[];
}) {
  const { t } = useTranslation();

  if (payments.length === 0) {
    return (
      <EmptyState
        description={t("cashPay.list.emptyBody")}
        title={t("cashPay.list.emptyTitle")}
      />
    );
  }

  return (
    <ul className="space-y-3">
      {payments.map((payment) => {
        const isAccepted = payment.status === "ACCEPTED";
        const isVoided = payment.status === "VOIDED";

        return (
          <li key={payment.id}>
            <Card className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold leading-snug">
                    {payment.payer.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatMessage(t("cashPay.list.house"), {
                      number: payment.assessment.houseNumberSnapshot,
                    })}
                  </p>
                </div>
                <p
                  className={cn(
                    "shrink-0 text-base font-semibold tabular-nums",
                    isVoided && "text-muted-foreground line-through",
                  )}
                >
                  {formatAmount(payment.amount)}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <Badge
                  dot
                  variant={
                    isAccepted ? "success" : isVoided ? "neutral" : "outline"
                  }
                >
                  {isAccepted
                    ? t("cashPay.status.accepted")
                    : isVoided
                      ? t("cashPay.status.voided")
                      : payment.status}
                </Badge>
                <time
                  className="text-xs text-muted-foreground"
                  dateTime={payment.createdAt.toISOString()}
                >
                  {formatYangonDateTime(payment.createdAt)}
                </time>
              </div>

              {isVoided && payment.voidReason ? (
                <div className="mt-3 rounded-lg bg-muted p-3 text-sm">
                  <p className="text-xs font-semibold text-muted-foreground">
                    {t("cashPay.list.voidReason")}
                  </p>
                  <p className="mt-0.5">{payment.voidReason}</p>
                </div>
              ) : null}

              {isAccepted && payment.fund.status === "ACTIVE" ? (
                <details className="mt-3 border-t pt-3">
                  <summary
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                      className:
                        "w-full cursor-pointer list-none border-danger-border text-danger-strong hover:bg-danger-soft sm:w-auto [&::-webkit-details-marker]:hidden",
                    })}
                  >
                    {t("cashPay.void.open")}
                  </summary>
                  <div className="mt-3">
                    <VoidPaymentForm paymentId={payment.id} />
                  </div>
                </details>
              ) : null}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
