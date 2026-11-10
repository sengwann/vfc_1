import "server-only";

import { UserRole } from "@prisma/client";

import { requireAuthenticatedUser } from "../../../lib/auth/guards";
import { requireChief, requireSystemAdmin } from "../../../lib/authz";

/**
 * The signed-in Chief or System Admin, nobody else. A Chief must also be an
 * active member of an active village (requireChief checks that); a Villager is
 * sent to the forbidden page. Which requests the person may act on is decided
 * again, from the database, inside each transition.
 */
export async function requireRecoveryApprover(): Promise<{
  id: string;
  role: "CHIEF" | "SYSTEM_ADMIN";
}> {
  const user = await requireAuthenticatedUser();

  if (user.role === UserRole.SYSTEM_ADMIN) {
    await requireSystemAdmin();
    return { id: user.id, role: "SYSTEM_ADMIN" };
  }

  await requireChief();
  return { id: user.id, role: "CHIEF" };
}
