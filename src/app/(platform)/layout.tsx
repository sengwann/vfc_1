import type { ReactNode } from "react";
import { AppShell } from "../../features/shell/components/app-shell";
import { buildPlatformNavigation } from "../../features/shell/lib/navigation";
import { getPlatformShellContext } from "../../features/shell/lib/shell-context";
import { countPendingDeactivationRequests } from "../../features/village-deactivation/lib/deactivation-queries";
import { RecoverySecurityNotice } from "../../features/password-recovery/components/recovery-security-notice";
import { countPendingRecoveryRequestsForApprover } from "../../features/password-recovery/lib/recovery-queries";
import { TranslationProvider } from "../../lib/i18n/provider";
import { prisma } from "../../lib/prisma";

export default async function PlatformLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user, language } = await getPlatformShellContext();
  const pendingDeactivations = await countPendingDeactivationRequests();
  const pendingRecovery = await countPendingRecoveryRequestsForApprover(prisma, {
    userId: user.id,
    now: new Date(),
  });
  const navigation = buildPlatformNavigation(
    language,
    pendingDeactivations,
    pendingRecovery,
  );
  return (
    <TranslationProvider language={language}>
      <AppShell
        navigation={navigation}
        user={user}
        variant="platform"
        language={language}
      >
        <RecoverySecurityNotice language={language} userId={user.id} />
        {children}
      </AppShell>
    </TranslationProvider>
  );
}
