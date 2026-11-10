import { redirect } from "next/navigation";
import { SignupScreen } from "@/features/villager-registration/components/registration-screens";
import { DEFAULT_POST_LOGIN_ROUTE } from "@/lib/auth/auth.constants";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata = {
  title: "Sign Up | Village Fund Collection System",
};

export default async function SignupPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect(DEFAULT_POST_LOGIN_ROUTE);
  }

  return <SignupScreen />;
}
