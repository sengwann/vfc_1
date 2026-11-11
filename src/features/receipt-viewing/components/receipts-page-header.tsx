"use client";

import { PageHeader } from "@/components/ui/page-header";
import { useTranslation } from "@/lib/i18n/provider";

export function ReceiptListHeader({
  accessLevel,
}: {
  accessLevel: "village" | "collector" | "own";
}) {
  const { t } = useTranslation();

  const description =
    accessLevel === "village"
      ? t("receipts.list.description.village")
      : accessLevel === "collector"
        ? t("receipts.list.description.collector")
        : t("receipts.list.description.own");

  return (
    <PageHeader description={description} title={t("receipts.list.title")} />
  );
}

export function ReceiptDetailHeader() {
  const { t } = useTranslation();

  return (
    <PageHeader
      backHref="/village/receipts"
      backLabel={t("receipts.back")}
      description={t("receipts.detail.description")}
      title={t("receipts.detail.title")}
    />
  );
}
