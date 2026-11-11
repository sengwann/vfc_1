import { ForgotPasswordForm } from "@/features/password-recovery/components/forgot-password-form";
import { RecoveryAuthShell } from "@/features/password-recovery/components/recovery-auth-shell";

export const metadata = {
  title: "Forgot password | Village Fund Collection System",
};

export default function ForgotPasswordPage() {
  return (
    <RecoveryAuthShell
      subtitleKey="recovery.forgot.subtitle"
      titleKey="recovery.forgot.title"
    >
      <ForgotPasswordForm />
    </RecoveryAuthShell>
  );
}
