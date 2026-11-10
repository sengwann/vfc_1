"use client";

import type { ReceiptStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n/provider";

export function ReceiptStatusBadge({ status }: { status: ReceiptStatus }) {
  const { t } = useTranslation();

  if (status === "ACTIVE") {
    return (
      <Badge dot variant="success">
        {t("receipts.status.active")}
      </Badge>
    );
  }

  return (
    <Badge dot variant="neutral">
      {t("receipts.status.voided")}
    </Badge>
  );
}
