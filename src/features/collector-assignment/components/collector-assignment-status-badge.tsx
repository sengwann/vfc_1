"use client";

import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n/provider";
import type { PeriodStatus } from "../lib/collector-period";

export function CollectorAssignmentStatusBadge({
  isActive,
  periodStatus,
}: {
  isActive: boolean;
  periodStatus: PeriodStatus;
}) {
  const { t } = useTranslation();

  if (!isActive) {
    return (
      <Badge className="shrink-0" dot variant="neutral">
        {t("collectors.status.inactive")}
      </Badge>
    );
  }

  if (periodStatus === "past") {
    return (
      <Badge className="shrink-0" dot variant="neutral">
        {t("collectors.status.ended")}
      </Badge>
    );
  }

  return (
    <Badge className="shrink-0" dot variant="success">
      {t("collectors.status.active")}
    </Badge>
  );
}
