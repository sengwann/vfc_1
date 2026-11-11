"use client";

import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/lib/i18n/provider";

export function HouseStatusBadge({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();

  if (isActive) {
    return (
      <Badge dot variant="success">
        {t("houses.status.active")}
      </Badge>
    );
  }

  return (
    <Badge dot variant="neutral">
      {t("houses.status.inactive")}
    </Badge>
  );
}