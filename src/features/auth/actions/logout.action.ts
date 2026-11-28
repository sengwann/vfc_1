"use server";

import { redirect } from "next/navigation";
import { AuditActionType } from "@prisma/client";
import {
  destroySession,
  getSessionIdentity,
  revokeMatchingSession,
} from "../../../lib/auth/session";
import { LOGIN_ROUTE } from "../../../lib/auth/auth.constants";
import { prisma } from "../../../lib/prisma";
import { AuditEntityType, tryCreateAuditLog } from "../../../lib/audit";

export async function logoutAction(): Promise<void> {
  try {
    const identity = await getSessionIdentity();
    // A suspended village blocks access, but its signed sessions can still be revoked.
    const user = identity
      ? await revokeMatchingSession(identity.userId, identity.sessionVersion)
      : null;

    if (user) {
      await tryCreateAuditLog(prisma, {
        actionType: AuditActionType.LOGOUT,
        entityType: AuditEntityType.SESSION,
        entityId: user.id,
        villageId: user.villageId ?? null,
        actorUserId: user.id,
        metadata: { userRole: user.role, villageId: user.villageId },
      });
    }
  } finally {
    // Always drop the browser cookie, even if revocation or auditing threw.
    await destroySession();
  }

  redirect(LOGIN_ROUTE);
}
