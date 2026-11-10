import { redirect } from "next/navigation";
import { LoginScreen } from "@/features/auth/components/login-screen";
import { getCurrentUser } from "@/lib/auth/session";
import { CHANGE_PASSWORD_ROUTE } from "@/lib/auth/auth.constants";
import {
  getSafeRedirectPath,
  normalizeLoginVillageCode,
} from "@/lib/auth/validators";

export const metadata = {
  title: "Login | Village Fund Collection System",
};

type SearchParams = Record<string, string | string[] | undefined>;

async function resolveSearchParams(
  searchParams: unknown,
): Promise<SearchParams> {
  if (!searchParams) {
    return {};
  }

  const maybePromise = searchParams as {
    then?: unknown;
  };

  if (typeof maybePromise.then === "function") {
    return await (searchParams as Promise<SearchParams>);
  }

  return searchParams as SearchParams;
}

function getFirstStringValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: unknown;
}) {
  const user = await getCurrentUser();

  const params = await resolveSearchParams(searchParams);
  // Only same-origin paths survive; anything else falls back to the default.
  const redirectTo = getSafeRedirectPath(getFirstStringValue(params.redirect));

  if (user) {
    redirect(user.mustChangePassword ? CHANGE_PASSWORD_ROUTE : redirectTo);
  }

  const registered = getFirstStringValue(params.registered) === "1";
  const passwordReset = getFirstStringValue(params.reset) === "1";

  // Registration sends the village code along so the new villager does not
  // have to type it again. It is only a pre-fill; the sign-in re-validates it.
  const rawVillage = normalizeLoginVillageCode(
    getFirstStringValue(params.village) ?? "",
  );
  const defaultVillageCode = /^[A-Z0-9]{3,20}$/.test(rawVillage)
    ? rawVillage
    : "";

  return (
    <LoginScreen
      defaultVillageCode={defaultVillageCode}
      redirectTo={redirectTo}
      passwordReset={passwordReset}
      registered={registered}
    />
  );
}
