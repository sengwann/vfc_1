import "server-only";

import { AuditActionType, MembershipStatus, type Prisma } from "@prisma/client";
import { AuditEntityType, createAuditLog } from "../../../lib/audit";
import { canDeactivateAssignment } from "../../collector-assignment/lib/collector-assignment-rules";
import { getPeriodStatus } from "../../collector-assignment/lib/collector-period";

export const MEMBER_REMOVED_REASON = "MEMBER_REMOVED";

export const REMOVE_MEMBER_ERROR = {
  HEAD_AUTHORITY_CHANGED: "REMOVE_MEMBER_HEAD_AUTHORITY_CHANGED",
  TARGET_NOT_REMOVABLE: "REMOVE_MEMBER_TARGET_NOT_REMOVABLE",
  UNEXPECTED_ASSIGNMENT_UPDATE_COUNT:
    "REMOVE_MEMBER_UNEXPECTED_ASSIGNMENT_UPDATE_COUNT",
} as const;

export interface RemoveMemberTransactionInput {
  actorUserId: string;
  houseId: string;
  villageId: string;
  targetUserId: string;
  currentPeriod: { year: number; month: number };
}

export interface RemoveMemberTransactionResult {
  deactivatedAssignmentIds: string[];
}

/**
 * Caller must first use beginHouseholdWrite with the actor, target and
 * deactivateAssignmentsFor option; it acquires all ordered row locks.
 * Must run inside a Serializable transaction (see remove-member.action.ts).
 * Any thrown error rolls back the member removal, assignment deactivations
 * and every audit entry written here.
 *
 * Collector assignments for past periods are never changed (history lock).
 * Current and upcoming active assignments of the removed member are
 * deactivated, with one STATUS_CHANGE audit entry per assignment that this
 * call actually deactivated.
 */
export async function removeMemberAndDeactivateAssignments(
  tx: Prisma.TransactionClient,
  input: RemoveMemberTransactionInput,
): Promise<RemoveMemberTransactionResult> {
  const { actorUserId, houseId, villageId, targetUserId, currentPeriod } =
    input;

  // Re-verify the actor's authority inside the transaction. The head check
  // done before the transaction can be stale if the head changed meanwhile.
  const house = await tx.house.findFirst({
    where: {
      id: houseId,
      villageId,
      isActive: true,
      headOfHouseId: actorUserId,
    },
    select: { id: true },
  });

  if (!house) {
    throw new Error(REMOVE_MEMBER_ERROR.HEAD_AUTHORITY_CHANGED);
  }

  // The actor is the head, so the head can never be removed here.
  if (targetUserId === actorUserId) {
    throw new Error(REMOVE_MEMBER_ERROR.TARGET_NOT_REMOVABLE);
  }

  const removed = await tx.user.updateMany({
    where: {
      id: targetUserId,
      houseId,
      villageId,
      membershipStatus: MembershipStatus.ACTIVE,
    },
    data: {
      membershipStatus: MembershipStatus.REMOVED,
    },
  });

  if (removed.count !== 1) {
    throw new Error(REMOVE_MEMBER_ERROR.TARGET_NOT_REMOVABLE);
  }

  await createAuditLog(tx, {
    actionType: AuditActionType.REMOVE,
    entityType: AuditEntityType.USER,
    entityId: targetUserId,
    villageId,
    actorUserId,
    metadata: {
      previousMembershipStatus: MembershipStatus.ACTIVE,
      newMembershipStatus: MembershipStatus.REMOVED,
      houseId,
    },
  });

  const activeAssignments = await tx.collectorAssignment.findMany({
    where: {
      villageId,
      userId: targetUserId,
      isActive: true,
    },
    select: {
      id: true,
      year: true,
      month: true,
      user: { select: { name: true } },
    },
    orderBy: [{ year: "asc" }, { month: "asc" }],
  });

  const deactivatedAssignmentIds: string[] = [];

  for (const assignment of activeAssignments) {
    const periodStatus = getPeriodStatus(
      assignment.year,
      assignment.month,
      currentPeriod,
    );

    // Past periods are locked: leave them untouched.
    if (!canDeactivateAssignment(true, periodStatus)) {
      continue;
    }

    const deactivated = await tx.collectorAssignment.updateMany({
      where: {
        id: assignment.id,
        villageId,
        userId: targetUserId,
        isActive: true,
      },
      data: { isActive: false },
    });

    // Already deactivated by another request (for example the Chief).
    // The desired state is reached, so skip it and do not write a
    // duplicate audit entry.
    if (deactivated.count === 0) {
      continue;
    }

    // The id is unique, so anything other than 0 or 1 is unexpected.
    if (deactivated.count !== 1) {
      throw new Error(REMOVE_MEMBER_ERROR.UNEXPECTED_ASSIGNMENT_UPDATE_COUNT);
    }

    deactivatedAssignmentIds.push(assignment.id);

    await createAuditLog(tx, {
      actionType: AuditActionType.STATUS_CHANGE,
      entityType: AuditEntityType.COLLECTOR_ASSIGNMENT,
      entityId: assignment.id,
      villageId,
      actorUserId,
      metadata: {
        year: assignment.year,
        month: assignment.month,
        isActive: false,
        assignedUserId: targetUserId,
        assignedUserName: assignment.user.name,
        reason: MEMBER_REMOVED_REASON,
      },
    });
  }

  return { deactivatedAssignmentIds };
}
