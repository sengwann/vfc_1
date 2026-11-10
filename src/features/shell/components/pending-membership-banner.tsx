"use client";

import { Alert } from "../../../components/ui/alert";
import { useTranslation } from "../../../lib/i18n/provider";
import { getAwaitingChiefText } from "../lib/awaiting-chief-text";

export function PendingMembershipBanner({
  awaitingChiefApproval = false,
}: {
  /** The member's house has no head yet, so the Village Chief decides. */
  awaitingChiefApproval?: boolean;
}) {
  const { t, language } = useTranslation();
  return (
    <Alert tone="warning" title={t("shell.pendingTitle")}>
      {awaitingChiefApproval
        ? getAwaitingChiefText(language).banner
        : t("shell.pendingBanner")}
    </Alert>
  );
}