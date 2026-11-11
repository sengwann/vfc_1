import "server-only";
import { MembershipStatus, UserRole } from "@prisma/client";
import { requireAuthenticatedUser } from "../../../lib/auth/guards";
import { redirectForbidden } from "../../../lib/authz/authz.errors";
import { getActiveCollectorContext } from "../../../lib/authz";
import type { SessionUser } from "../../../lib/auth/auth.types";

export type ReceiptAccessLevel = "village" | "collector" | "own";

export interface ReceiptAccessContext {
  user: SessionUser;
  villageId: string;
  accessLevel: ReceiptAccessLevel;
}

export async function requireReceiptAccess(): Promise<ReceiptAccessContext> {
  const user = await requireAuthenticatedUser();

  if (user.role === UserRole.SYSTEM_ADMIN || !user.villageId) {
    return redirectForbidden();
  }

  const villageId = user.villageId;

  if (
    user.role === UserRole.CHIEF &&
    user.membershipStatus === MembershipStatus.ACTIVE
  ) {
    return { user, villageId, accessLevel: "village" };
  }

  if (user.membershipStatus === MembershipStatus.ACTIVE) {
    const collectorContext = await getActiveCollectorContext(user);
    if (collectorContext) {
      return { user, villageId, accessLevel: "collector" };
    }
  }

  if (
    user.role === UserRole.VILLAGER &&
    user.membershipStatus === MembershipStatus.ACTIVE
  ) {
    return { user, villageId, accessLevel: "own" };
  }

  return redirectForbidden();
}
