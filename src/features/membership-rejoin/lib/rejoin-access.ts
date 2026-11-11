import "server-only";

import { MembershipStatus, UserRole } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "../../../lib/auth/guards";
import type { SessionUser } from "../../../lib/auth/auth.types";

export interface RejoinContext {
  user: SessionUser;
  villageId: string;
  membershipStatus: MembershipStatus;
}

export async function requireRejoinContext(): Promise<RejoinContext> {
  const user = await requireAuthenticatedUser();

  if (user.role === UserRole.SYSTEM_ADMIN || !user.villageId) {
    redirect("/dashboard");
  }

  const villageId = user.villageId;
  const status = user.membershipStatus;

  if (
    status === MembershipStatus.ACTIVE ||
    status === MembershipStatus.PENDING
  ) {
    redirect("/village/dashboard");
  }

  if (
    status !== MembershipStatus.REJECTED &&
    status !== MembershipStatus.REMOVED
  ) {
    redirect("/dashboard");
  }

  return {
    user,
    villageId,
    membershipStatus: status,
  };
}
