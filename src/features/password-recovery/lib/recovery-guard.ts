import "server-only";

import { UserRole } from "@prisma/client";

import { requireAuthenticatedUserWithIdentity } from "../../../lib/auth/guards";
import { requireChief, requireSystemAdmin } from "../../../lib/authz";

export type RecoveryApprover = Readonly<{
  userId: string;
  sessionVersion: number;
} & (
  | { role: "SYSTEM_ADMIN" }
  | { role: "CHIEF"; villageId: string }
)>;

/**
 * The signed-in Chief or System Admin, nobody else. A Chief must also be an
 * active member of an active village (requireChief checks that); a Villager is
 * sent to the forbidden page. Which requests the person may act on is decided
 * again, from the database, inside each transition.
 */
export async function requireRecoveryApprover(): Promise<RecoveryApprover> {
  const { user, identity } = await requireAuthenticatedUserWithIdentity();

  if (user.role === UserRole.SYSTEM_ADMIN) {
    await requireSystemAdmin();
    return { ...identity, role: "SYSTEM_ADMIN" };
  }

  const { villageId } = await requireChief();
  return { ...identity, role: "CHIEF", villageId };
}
