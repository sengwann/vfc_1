import { redirect } from "next/navigation";
import { MembershipStatus, UserRole } from "@prisma/client";
import { getCurrentUser } from "../../lib/auth/session";
import {
  CHANGE_PASSWORD_ROUTE,
  LOGIN_ROUTE,
} from "../../lib/auth/auth.constants";

export const metadata = {
  title: "Dashboard | Village Fund Collection System",
};

export default async function DashboardRedirectPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect(LOGIN_ROUTE);
  }

  if (user.mustChangePassword) {
    redirect(CHANGE_PASSWORD_ROUTE);
  }

  if (user.role === UserRole.SYSTEM_ADMIN) {
    redirect("/admin/dashboard");
  }

  if (
    user.membershipStatus === MembershipStatus.REJECTED ||
    user.membershipStatus === MembershipStatus.REMOVED
  ) {
    redirect("/rejoin");
  }

  redirect("/village/dashboard");
}
