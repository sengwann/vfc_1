import "server-only";

import { redirect } from "next/navigation";

import { CHANGE_PASSWORD_ROUTE, LOGIN_ROUTE } from "./auth.constants";
import { getCurrentUser, getSessionIdentity } from "./session";
import type { SessionUser } from "./auth.types";

/**
 * Signed-in user, WITHOUT the forced password change check.
 *
 * Only two things may use this: the change-password page and action (the one
 * way out of the forced change), and sign-out. Everything else must use
 * requireAuthenticatedUser. A test (password-gate-coverage.test.ts) fails if
 * any other file calls this or getCurrentUser directly.
 */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getCurrentUser();

  if (!user) {
    return redirect(LOGIN_ROUTE);
  }

  return user;
}

/**
 * Signed-in user whose password is not waiting to be changed. This is the
 * guard behind every protected page, layout and server action, so a Chief who
 * has not yet replaced the initial password is stopped here on the server,
 * not only by a redirect in the UI.
 */
export async function requireAuthenticatedUser(): Promise<SessionUser> {
  const user = await requireSessionUser();

  if (user.mustChangePassword) {
    return redirect(CHANGE_PASSWORD_ROUTE);
  }

  return user;
}

/** For guarded writes that must carry the original signed version into a transaction. */
export async function requireAuthenticatedUserWithIdentity() {
  const user = await requireAuthenticatedUser();
  const identity = await getSessionIdentity();
  if (!identity || identity.userId !== user.id) return redirect(LOGIN_ROUTE);
  return { user, identity };
}
