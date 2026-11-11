"use client";

import type { FundStatus } from "@prisma/client";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import type { TranslationKey } from "@/lib/i18n/en";
import { useTranslation } from "@/lib/i18n/provider";

const VARIANTS: Record<FundStatus, BadgeVariant> = {
  DRAFT: "info",
  ACTIVE: "success",
  CLOSED: "neutral",
};

const LABELS: Record<FundStatus, TranslationKey> = {
  DRAFT: "funds.status.draft",
  ACTIVE: "funds.status.active",
  CLOSED: "funds.status.closed",
};

export function FundStatusBadge({ status }: { status: FundStatus }) {
  const { t } = useTranslation();

  return (
    <Badge dot variant={VARIANTS[status]}>
      {t(LABELS[status])}
    </Badge>
  );
}
