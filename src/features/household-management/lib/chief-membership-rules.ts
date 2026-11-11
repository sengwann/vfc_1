import { MembershipStatus, UserRole } from "@prisma/client";

/*
 * Rules for the Chief deciding on a pending member of a house that has NO head.
 * Pure functions with no server-only dependency, so they can be unit-tested.
 * Authentication, role and village scoping are enforced by the actions that
 * call these (requireChief + village-scoped queries), not here.
 */

export interface ChiefDecisionTarget {
  id: string;
  role: UserRole;
  membershipStatus: MembershipStatus | null;
}

export interface ChiefDecisionHouse {
  isActive: boolean;
  headOfHouseId: string | null;
}

/**
 * The Chief may approve a pending member as the FIRST head of a house only
 * while the house is active and still has no head.
 */
export function canChiefApproveFirstMember(
  target: ChiefDecisionTarget,
  house: ChiefDecisionHouse,
  actorId: string,
): boolean {
  return (
    house.isActive &&
    house.headOfHouseId === null &&
    target.role === UserRole.VILLAGER &&
    target.membershipStatus === MembershipStatus.PENDING &&
    target.id !== actorId
  );
}

/**
 * The Chief may reject a pending member only while the house has no head.
 * Once a head exists, only that head decides on pending members. Rejecting is
 * allowed on an inactive house so leftover pending members can be cleared.
 */
export function canChiefRejectPendingMember(
  target: ChiefDecisionTarget,
  house: ChiefDecisionHouse,
  actorId: string,
): boolean {
  return (
    house.headOfHouseId === null &&
    target.role === UserRole.VILLAGER &&
    target.membershipStatus === MembershipStatus.PENDING &&
    target.id !== actorId
  );
}
