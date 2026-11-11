import "server-only";

import { MembershipStatus, UserRole } from "@prisma/client";

import { requireAuthenticatedUser } from "../auth/guards";
import type { SessionUser } from "../auth/auth.types";

import { redirectForbidden } from "./authz.errors";
import type { VillageContext } from "./authz.types";

export function getVillageContext(user: SessionUser): VillageContext | null {
  if (user.role === UserRole.SYSTEM_ADMIN) {
    return null;
  }

  if (!user.villageId) {
    return null;
  }

  return {
    user,
    villageId: user.villageId,
  };
}

export function hasActiveMembership(user: SessionUser): boolean {
  return user.membershipStatus === MembershipStatus.ACTIVE;
}

export async function requireVillageContext(): Promise<VillageContext> {
  const user = await requireAuthenticatedUser();

  const context = getVillageContext(user);

  if (!context) {
    return redirectForbidden();
  }

  return context;
}
