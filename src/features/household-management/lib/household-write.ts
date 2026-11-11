import "server-only";
import { MembershipStatus, UserRole } from "@prisma/client";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import { TransactionAuthorityError } from "@/lib/authz/transaction-authority";
import { guardVillageWrite } from "@/lib/authz/village-write-guard";
import { acquireVillageScopes, assertTransactionClient, orderedVillageIds, type FinancialTransactionClient } from "@/lib/db/village-scope";
import { lockFunds, lockHouses } from "@/lib/db/financial-locks";

interface HouseholdWrite {
  villageId: string;
  permission: "chief" | "head" | "rejoin" | "registration";
  /** Expected identity from authenticated server context, never form input. */
  actorUserId?: string;
  houseIds?: readonly string[];
  houseNumber?: string;
  targetUserIds?: readonly string[];
  deactivateAssignmentsFor?: string;
}
interface Actor {
  id: string; villageId: string | null; houseId: string | null;
  role: UserRole; membershipStatus: MembershipStatus | null;
  sessionVersion: number; mustChangePassword: boolean;
}
/** Entry only. No entity locks/decisions may precede this call. */
export async function beginHouseholdWrite(tx: FinancialTransactionClient, input: HouseholdWrite) {
  assertTransactionClient(tx);
  const identity = input.permission === "registration" ? null : await getSessionIdentity();
  if (input.permission !== "registration" && (!identity || identity.userId !== input.actorUserId)) throw new TransactionAuthorityError("VFC_AUTH_SESSION");
  await acquireVillageScopes(tx, [input.villageId]);
  const guard = await guardVillageWrite(tx, input.villageId);
  if (!guard.ok) return guard;
  // Discovery only: no authority is granted from this read. Village scope guards
  // concurrent membership writers; User row below remains authoritative.
  const discovery = identity ? await tx.user.findUnique({ where: { id: identity.userId }, select: { houseId: true, villageId: true } }) : null;
  if (discovery && discovery.villageId !== input.villageId) throw new TransactionAuthorityError("VFC_AUTH_VILLAGE");
  const selected = input.houseNumber === undefined ? null : await tx.house.findUnique({
    where: { villageId_houseNumber: { villageId: input.villageId, houseNumber: input.houseNumber } }, select: { id: true },
  });
  const houseIds = [...input.houseIds ?? [], ...(discovery?.houseId ? [discovery.houseId] : []), ...(selected ? [selected.id] : [])];
  const funds = await tx.fund.findMany({ where: { villageId: input.villageId, status: "ACTIVE" }, select: { id: true, villageId: true } });
  await lockFunds(tx, funds);
  const houses = await lockHouses(tx, houseIds.map((id) => ({ id, villageId: input.villageId })));
  const ids = [...input.targetUserIds ?? [], ...(identity ? [identity.userId] : [])];
  const users: Actor[] = [];
  for (const id of ids.length ? orderedVillageIds(ids) : []) {
    const rows = await tx.$queryRaw<Actor[]>`
      SELECT id,"villageId","houseId",role::text AS role,"membershipStatus"::text AS "membershipStatus","sessionVersion","mustChangePassword"
      FROM public."User" WHERE id=${id} AND "villageId"=${input.villageId} FOR NO KEY UPDATE`;
    if (!rows[0]) throw new TransactionAuthorityError("VFC_AUTH_VILLAGE");
    users.push(rows[0]);
  }
  if (identity) {
    const actor = users.find((row) => row.id === identity.userId)!;
    if (actor.sessionVersion !== identity.sessionVersion) throw new TransactionAuthorityError("VFC_AUTH_SESSION");
    if (actor.mustChangePassword) throw new TransactionAuthorityError("VFC_AUTH_PASSWORD_CHANGE");
    if (actor.houseId !== (discovery?.houseId ?? null)) {
      // A legacy writer changed the discovered scope. Abort the whole attempt;
      // the retry discovers and acquires the complete current House set.
      throw Object.assign(new Error("VFC_HOUSE_SCOPE_CHANGED"), { code: "40001" });
    }
    if (actor.role !== UserRole.CHIEF && actor.role !== UserRole.VILLAGER) throw new TransactionAuthorityError("VFC_AUTH_ROLE");
    if (input.permission === "rejoin") {
      if (actor.membershipStatus !== MembershipStatus.REJECTED && actor.membershipStatus !== MembershipStatus.REMOVED) throw new Error("INVALID_REJOIN_STATE");
    } else {
      if (actor.membershipStatus !== MembershipStatus.ACTIVE) throw new TransactionAuthorityError("VFC_AUTH_MEMBERSHIP");
      if (input.permission === "chief" && actor.role !== UserRole.CHIEF) throw new TransactionAuthorityError("VFC_AUTH_ROLE");
      if (input.permission === "head" && !(input.houseIds?.length === 1 && houses.some((h) => h.id === input.houseIds![0] && h.id === actor.houseId && h.isActive && h.headOfHouseId === actor.id))) throw new Error("HOUSEHOLD_ACCESS_CHANGED");
    }
  }
  if (input.deactivateAssignmentsFor) {
    await tx.$queryRaw`SELECT id FROM public."CollectorAssignment" WHERE "villageId"=${input.villageId} AND "userId"=${input.deactivateAssignmentsFor} ORDER BY id FOR UPDATE`;
  }
  return guard;
}

export async function assertHouseNotAssessed(tx: FinancialTransactionClient, villageId: string, houseId: string) {
  const assessed = await tx.fundHouseAssessment.findFirst({ where: { villageId, houseId, fund: { status: "ACTIVE" } }, select: { id: true } });
  if (assessed) throw new Error("HOUSE_ACTIVE_FUND_ASSESSMENT");
}
