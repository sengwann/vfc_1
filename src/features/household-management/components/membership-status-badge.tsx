"use client";

import type { MembershipStatus } from "@prisma/client";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/en";

/*
 * Type-only Prisma import on purpose: this is a client component, so the
 * enum's runtime value must not be bundled. String keys match the enum.
 */
const STATUS_CONFIG: Record<
  MembershipStatus,
  { variant: BadgeVariant; label: TranslationKey }
> = {
  PENDING: { variant: "warning", label: "shell.membership.pending" },
  ACTIVE: { variant: "success", label: "shell.membership.active" },
  REJECTED: { variant: "danger", label: "shell.membership.rejected" },
  REMOVED: { variant: "neutral", label: "shell.membership.removed" },
};

export function MembershipStatusBadge({
  status,
}: {
  status: MembershipStatus;
}) {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status];

  return (
    <Badge dot variant={config.variant}>
      {t(config.label)}
    </Badge>
  );
}
