import { RecoveryAuthShell } from "@/features/password-recovery/components/recovery-auth-shell";
import { ResetPasswordForm } from "@/features/password-recovery/components/reset-password-form";

export const metadata = {
  title: "Reset password | Village Fund Collection System",
};

export default function ResetPasswordPage() {
  return (
    <RecoveryAuthShell
      subtitleKey="recovery.reset.subtitle"
      titleKey="recovery.reset.title"
    >
      <ResetPasswordForm />
    </RecoveryAuthShell>
  );
}
