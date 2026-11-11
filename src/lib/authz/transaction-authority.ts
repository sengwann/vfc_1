import "server-only";
import { MembershipStatus, UserRole } from "@prisma/client";
import { getSessionIdentity } from "../auth/session-identity";
import { acquireVillageScopes, assertTransactionClient, type FinancialTransactionClient } from "../db/village-scope";
import { lockFunds, lockHouses } from "../db/financial-locks";
import { guardVillageWrite } from "./village-write-guard";
import { getCurrentPeriod } from "./collector-period";

export type FinancialPermission = "chief" | "collector" | "member";
export class TransactionAuthorityError extends Error {
  constructor(readonly code:
    | "VFC_AUTH_SESSION" | "VFC_AUTH_PASSWORD_CHANGE" | "VFC_AUTH_MEMBERSHIP"
    | "VFC_AUTH_VILLAGE" | "VFC_AUTH_ROLE" | "VFC_AUTH_COLLECTOR"
    | "VILLAGE_INACTIVE" | "VILLAGE_READ_ONLY") {
    super(code);
  }
}
interface Actor {
  id: string;
  role: UserRole;
  villageId: string | null;
  houseId: string | null;
  membershipStatus: MembershipStatus | null;
  sessionVersion: number;
  mustChangePassword: boolean;
}
export interface FinancialAuthorityRequest {
  /** Target tenant only, never evidence of the actor's tenant or authority. */
  villageId: string;
  permission: FinancialPermission;
  fundIds?: readonly string[];
  houseIds?: readonly string[];
}

/**
 * Transaction ENTRY: call once, before reads/locks/writes. All required scopes
 * for this single-Village financial operation are acquired here. Do not call
 * after acquiring entity locks. Cross-Village lifecycle flows need their own
 * complete-scope entry, not repeated calls to this helper.
 * No redirects or external writes. Invoke anew on every whole-transaction retry.
 */
export async function authorizeFinancialTransaction(
  tx: FinancialTransactionClient,
  request: FinancialAuthorityRequest,
) {
  assertTransactionClient(tx);
  if (!["chief", "collector", "member"].includes(request.permission)) {
    throw new TypeError("Unknown financial permission");
  }
  // Only cryptographically verified cookie claims supply the actor identity.
  const identity = await getSessionIdentity();
  if (!identity) throw new TransactionAuthorityError("VFC_AUTH_SESSION");
  await acquireVillageScopes(tx, [request.villageId]);
  const village = await guardVillageWrite(tx, request.villageId);
  if (!village.ok) throw new TransactionAuthorityError(village.reason);
  const targets = (ids: readonly string[]) => ids.map((id) => ({ id, villageId: request.villageId }));
  const funds = await lockFunds(tx, targets(request.fundIds ?? []));
  const houses = await lockHouses(tx, targets(request.houseIds ?? []));
  // SHARE blocks concurrent role/password/session changes until commit. Actor
  // updates must not be performed after this helper (User lock upgrade risk).
  const actors = await tx.$queryRaw<Actor[]>`
    SELECT id, role::text AS role, "villageId", "houseId",
      "membershipStatus"::text AS "membershipStatus", "sessionVersion", "mustChangePassword"
    FROM public."User" WHERE id=${identity.userId} FOR SHARE
  `;
  const actor = actors[0];
  if (!actor || actor.sessionVersion !== identity.sessionVersion) throw new TransactionAuthorityError("VFC_AUTH_SESSION");
  if (actor.mustChangePassword) throw new TransactionAuthorityError("VFC_AUTH_PASSWORD_CHANGE");
  if (actor.villageId !== request.villageId) throw new TransactionAuthorityError("VFC_AUTH_VILLAGE");
  if (actor.membershipStatus !== MembershipStatus.ACTIVE) throw new TransactionAuthorityError("VFC_AUTH_MEMBERSHIP");
  if (actor.role !== UserRole.CHIEF && actor.role !== UserRole.VILLAGER) throw new TransactionAuthorityError("VFC_AUTH_ROLE");
  if (request.permission === "chief" && actor.role !== UserRole.CHIEF) throw new TransactionAuthorityError("VFC_AUTH_ROLE");
  let assignmentId: string | null = null;
  if (request.permission === "collector") {
    // Use the database wall clock AFTER waiting for locks, rather than a cached
    // request time or PostgreSQL transaction-start timestamp at a month boundary.
    const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const { year, month } = getCurrentPeriod(clock.now);
    const assignments = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM public."CollectorAssignment"
      WHERE "userId"=${actor.id} AND "villageId"=${request.villageId}
        AND year=${year} AND month=${month} AND "isActive"=true
      ORDER BY id FOR SHARE
    `;
    if (!assignments[0]) throw new TransactionAuthorityError("VFC_AUTH_COLLECTOR");
    assignmentId = assignments[0].id;
  }
  return { actor, villageId: request.villageId, assignmentId, funds, houses };
}
