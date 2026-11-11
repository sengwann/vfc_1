"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useTranslation } from "@/lib/i18n/provider";
import { fill } from "./fill";

export function DashboardHeader({
  name,
  pending = false,
}: {
  name: string;
  pending?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <PageHeader
      description={
        pending
          ? t("dashboard.pending.welcome")
          : fill(t("dashboard.welcome"), { name })
      }
      title={t("dashboard.title")}
    />
  );
}
