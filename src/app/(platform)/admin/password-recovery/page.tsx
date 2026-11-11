import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { RecoveryRequestsList } from "@/features/password-recovery/components/recovery-requests-list";
import { listRecoveryRequestsForApprover } from "@/features/password-recovery/lib/recovery-queries";
import {
  RECOVERY_ERROR_PARAM,
  RECOVERY_NOTICE_PARAM,
} from "@/features/password-recovery/lib/recovery-paths";
import { resolveRecoveryFeedback } from "@/features/password-recovery/lib/recovery-view";
import { getPlatformShellContext } from "@/features/shell/lib/shell-context";
import { requireSystemAdmin } from "@/lib/authz";
import { getT } from "@/lib/i18n/translations";
import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Password recovery | Village Fund Collection System",
};

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/*
 * The System Admin's list: Chiefs, other System Admins, and Villagers of a
 * village that has no active Chief. Authority is worked out per request.
 */
export default async function AdminPasswordRecoveryPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const admin = await requireSystemAdmin();
  const { language } = await getPlatformShellContext();
  const t = getT(language);

  const query = (await searchParams) ?? {};
  const feedback = resolveRecoveryFeedback(t, {
    error: firstValue(query[RECOVERY_ERROR_PARAM]),
    notice: firstValue(query[RECOVERY_NOTICE_PARAM]),
  });

  const views = await listRecoveryRequestsForApprover(prisma, {
    userId: admin.id,
    now: new Date(),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        description={t("recovery.approver.description")}
        title={t("recovery.approver.adminTitle")}
      />
      {feedback ? <Alert tone={feedback.tone}>{feedback.message}</Alert> : null}
      <RecoveryRequestsList language={language} views={views} />
    </div>
  );
}
