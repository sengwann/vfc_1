"use client";

import type { ReactNode } from "react";
import type { ReceiptStatus } from "@prisma/client";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { useTranslation } from "@/lib/i18n/provider";
import { cn, formatAmount, formatYangonDateTime } from "@/lib/utils";
import { ReceiptStatusBadge } from "./receipt-status-badge";

export interface ReceiptDetailData {
  id: string;
  receiptNumber: string;
  status: ReceiptStatus;
  createdAt: Date;
  payment: {
    id: string;
    amount: number;
    voidReason: string | null;
    createdAt: Date;
    fund: { name: string };
    assessment: { houseNumberSnapshot: string };
    payer: { name: string };
    collector: { name: string } | null;
  };
}

function DetailRow({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-sm font-medium text-foreground sm:text-end",
          mono && "break-all font-mono",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

function Missing() {
  const { t } = useTranslation();
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{t("receipts.notProvided")}</span>
    </>
  );
}

export function ReceiptDetailCard({ receipt }: { receipt: ReceiptDetailData }) {
  const { t } = useTranslation();
  const { payment } = receipt;
  const isVoided = receipt.status === "VOIDED";

  return (
    <div className="grid gap-6 lg:grid-cols-5 lg:items-start">
      <div className="space-y-4 lg:col-span-2">
        {isVoided ? (
          <Alert tone="warning" title={t("receipts.void.title")}>
            <p>{t("receipts.void.body")}</p>
            {payment.voidReason ? (
              <p className="mt-2">
                <span className="font-semibold">
                  {t("receipts.void.reason")}:{" "}
                </span>
                {payment.voidReason}
              </p>
            ) : null}
          </Alert>
        ) : null}

        <Card className="overflow-hidden">
          <div className="space-y-4 p-5 text-center sm:p-6">
            <div className="flex justify-center">
              <ReceiptStatusBadge status={receipt.status} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {t("receipts.hero.label")}
              </p>
              <p
                className={cn(
                  "mt-1 text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl",
                  isVoided && "text-muted-foreground line-through",
                )}
              >
                {formatAmount(payment.amount)}
              </p>
            </div>
            <p className="text-sm font-medium">{payment.fund.name}</p>
          </div>

          <div className="border-t border-dashed border-border-strong bg-muted/60 px-5 py-4 text-center sm:px-6">
            <p className="text-xs font-medium text-muted-foreground">
              {t("receipts.field.receiptNumber")}
            </p>
            <p className="mt-0.5 break-all font-mono text-sm font-semibold">
              {receipt.receiptNumber}
            </p>
          </div>
        </Card>
      </div>

      <div className="space-y-6 lg:col-span-3">
        <Section title={t("receipts.details.title")}>
          <Card>
            <dl className="divide-y px-4 sm:px-6">
              <DetailRow label={t("receipts.field.date")}>
                <time dateTime={payment.createdAt.toISOString()}>
                  {formatYangonDateTime(payment.createdAt)}
                </time>
              </DetailRow>
              <DetailRow label={t("receipts.field.fund")}>
                {payment.fund.name}
              </DetailRow>
              <DetailRow label={t("receipts.field.house")}>
                {payment.assessment.houseNumberSnapshot}
              </DetailRow>
              <DetailRow label={t("receipts.field.payer")}>
                {payment.payer.name}
              </DetailRow>
              <DetailRow label={t("receipts.field.collector")}>
                {payment.collector?.name ?? <Missing />}
              </DetailRow>
            </dl>
          </Card>
        </Section>
      </div>
    </div>
  );
}
