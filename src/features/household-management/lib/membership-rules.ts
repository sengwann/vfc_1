import "server-only";

import { MembershipStatus } from "@prisma/client";

export interface MembershipActionTarget {
  id: string;
  membershipStatus: MembershipStatus | null;
}

export interface MembershipActionHouse {
  headOfHouseId: string | null;
}

export function canApprovePendingMember(
  target: MembershipActionTarget,
  house: MembershipActionHouse,
  actorId: string,
): boolean {
  return (
    target.membershipStatus === MembershipStatus.PENDING &&
    target.id !== house.headOfHouseId &&
    target.id !== actorId
  );
}

export function canRejectPendingMember(
  target: MembershipActionTarget,
  house: MembershipActionHouse,
  actorId: string,
): boolean {
  return (
    target.membershipStatus === MembershipStatus.PENDING &&
    target.id !== house.headOfHouseId &&
    target.id !== actorId
  );
}

export function canRemoveActiveMember(
  target: MembershipActionTarget,
  house: MembershipActionHouse,
  actorId: string,
): boolean {
  return (
    target.membershipStatus === MembershipStatus.ACTIVE &&
    target.id !== house.headOfHouseId &&
    target.id !== actorId
  );
}

export function canChangeHeadOfHouse(
  target: MembershipActionTarget,
  house: MembershipActionHouse,
  actorId: string,
): boolean {
  return (
    target.membershipStatus === MembershipStatus.ACTIVE &&
    target.id !== house.headOfHouseId &&
    target.id !== actorId
  );
}
