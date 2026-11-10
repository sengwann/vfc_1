import { Badge, type BadgeVariant } from "@/components/ui/badge";
import type { TranslationKey } from "@/lib/i18n/en";

import { STATUS_LABEL_KEYS } from "../lib/deactivation-view";

const TONES: Record<string, BadgeVariant> = {
  PENDING: "warning",
  APPROVED: "info",
  REJECTED: "danger",
  CANCELLED: "neutral",
  COMPLETED: "neutral",
};

export function DeactivationStatusBadge({
  status,
  t,
}: {
  status: string;
  t: (key: TranslationKey) => string;
}) {
  const key = STATUS_LABEL_KEYS[status];

  return (
    <Badge dot variant={TONES[status] ?? "neutral"}>
      {key ? t(key) : status}
    </Badge>
  );
}
