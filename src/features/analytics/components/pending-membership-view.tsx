"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { useTranslation } from "@/lib/i18n/provider";
import { getAwaitingChiefText } from "@/features/shell/lib/awaiting-chief-text";

export function PendingMembershipView({
  awaitingChiefApproval = false,
}: {
  /** The member's house has no head yet, so the Village Chief decides. */
  awaitingChiefApproval?: boolean;
}) {
  const { t, language } = useTranslation();
  return (
    <EmptyState
      description={
        awaitingChiefApproval
          ? getAwaitingChiefText(language).dashboardBody
          : t("dashboard.pending.body")
      }
      title={t("dashboard.pending.title")}
    />
  );
}