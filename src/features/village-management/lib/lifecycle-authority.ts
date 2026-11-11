import "server-only";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import { assertTransactionClient, type FinancialTransactionClient } from "@/lib/db/village-scope";

/** After Village/Fund locks. Session claims alone never grant lifecycle authority. */
export async function hasLifecycleAuthority(tx: FinancialTransactionClient, actorUserId: string, role: "SYSTEM_ADMIN" | "CHIEF", villageId?: string) {
  assertTransactionClient(tx);
  const identity = await getSessionIdentity();
  if (!identity || identity.userId !== actorUserId) return false;
  const [actor] = await tx.$queryRaw<Array<{ role: string; villageId: string | null; membershipStatus: string | null; sessionVersion: number; mustChangePassword: boolean }>>`
    SELECT role::text AS role, "villageId", "membershipStatus"::text AS "membershipStatus", "sessionVersion", "mustChangePassword"
    FROM public."User" WHERE id=${identity.userId} FOR SHARE`;
  return Boolean(actor && actor.sessionVersion === identity.sessionVersion && !actor.mustChangePassword && actor.role === role &&
    (role === "SYSTEM_ADMIN" || (actor.villageId === villageId && actor.membershipStatus === "ACTIVE")));
}
