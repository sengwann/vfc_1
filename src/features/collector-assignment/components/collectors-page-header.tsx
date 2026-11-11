"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useTranslation } from "@/lib/i18n/provider";

export function CollectorsPageHeader() {
  const { t } = useTranslation();

  return (
    <PageHeader
      description={t("collectors.description")}
      title={t("collectors.title")}
    />
  );
}
