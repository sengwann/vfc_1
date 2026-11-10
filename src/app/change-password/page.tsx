import { redirect } from "next/navigation";
import { RequiredPasswordChangeScreen } from "@/features/user-settings/components/required-password-change-screen";
import { DEFAULT_POST_LOGIN_ROUTE } from "@/lib/auth/auth.constants";
import { requireSessionUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Change Password | Village Fund Collection System",
};

/*
 * The only page a Chief can open before replacing the initial password. It
 * lives outside the (protected), (village) and (platform) route groups on
 * purpose: their layouts use requireAuthenticatedUser, which sends accounts
 * with mustChangePassword here.
 */
export default async function ChangePasswordPage() {
  const user = await requireSessionUser();

  if (!user.mustChangePassword) {
    redirect(DEFAULT_POST_LOGIN_ROUTE);
  }

  // A brand new Chief has no saved language yet; the screen then falls back
  // to the browser-only choice made on the sign-in page.
  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id },
    select: { language: true },
  });

  return (
    <RequiredPasswordChangeScreen savedLanguage={settings?.language ?? null} />
  );
}
