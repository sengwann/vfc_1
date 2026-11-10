/*
 * Pure planning of the in-app notifications for a password recovery request.
 * No imports, so it can be unit tested directly. It follows the deactivation
 * planner: notifications are DERIVED from the request's stored state, and every
 * one carries a dedupe key, so computing and storing a plan twice (a retry, a
 * double submit) never creates a duplicate.
 *
 *   request filed (PENDING)  -> the approvers who can act on it
 *   rejected                 -> the member, with the optional note
 *   completed                -> the member: "your password was changed" (the
 *                               post-reset notice, Safeguard 2)
 *   completed                -> the Chief or Admin who issued the code: "it was
 *                               used", and when
 *
 * Who the approvers are is decided by the caller (see recovery-authority.ts and
 * approverGroupFor) and passed in; this file never looks anything up.
 *
 * The text is not stored. `params` carries what the page needs to render
 * translated text when the notification is read. Params never contain a reset
 * code, a code hash, a password, or the member's email or phone number: only
 * names, times and roles. A test pins the exact set of keys.
 *
 * The member's "password changed" notice must be stored INSIDE the redeem
 * transaction, so a reset can never happen without it; the others are stored
 * after commit, best effort, like the deactivation notifications.
 */

export type RecoveryNotificationType =
  | "RECOVERY_REQUESTED"
  | "RECOVERY_REJECTED"
  | "RECOVERY_PASSWORD_CHANGED"
  | "RECOVERY_RESET_COMPLETED";

/**
 * Every recovery type. The deactivation notification helpers exclude these and
 * the recovery ones include only these, so "mark all as read" on one screen can
 * never touch the other family (a security notice must not be marked read from
 * the deactivation page).
 */
export const RECOVERY_NOTIFICATION_TYPES: readonly RecoveryNotificationType[] = [
  "RECOVERY_REQUESTED",
  "RECOVERY_REJECTED",
  "RECOVERY_PASSWORD_CHANGED",
  "RECOVERY_RESET_COMPLETED",
];

export type PlanRole = "CHIEF" | "SYSTEM_ADMIN";

export interface PlanPerson {
  id: string;
  name: string;
  role: PlanRole;
}

export interface RecoveryPlanRequest {
  id: string;
  /** The target's village, or null for a System Admin. */
  villageId: string | null;
  status: string;
  requestExpiresAt: Date;
  rejectionNote: string | null;
  rejectedAt: Date | null;
  completedAt: Date | null;
  /** Who is recovering the account. */
  target: { id: string; name: string };
  /** Whoever issued the (last) code, once there is one. */
  issuedBy: PlanPerson | null;
  rejectedBy: PlanPerson | null;
}

export interface PlannedRecoveryNotification {
  userId: string;
  villageId: string | null;
  recoveryRequestId: string;
  type: RecoveryNotificationType;
  dedupeKey: string;
  params: Record<string, string>;
}

export function recoveryDedupeKey(
  requestId: string,
  event: string,
  userId: string,
): string {
  return `recovery:${requestId}:${event}:${userId}`;
}

function iso(date: Date | null): string {
  return date ? date.toISOString() : "";
}

export function planRecoveryNotifications(input: {
  request: RecoveryPlanRequest;
  /** The approvers who can act on this request (never trusted to be unique). */
  approverUserIds: readonly string[];
}): PlannedRecoveryNotification[] {
  const { request, approverUserIds } = input;
  const planned: PlannedRecoveryNotification[] = [];

  const add = (
    userIds: readonly string[],
    type: RecoveryNotificationType,
    event: string,
    params: Record<string, string>,
  ) => {
    for (const userId of new Set(userIds)) {
      planned.push({
        userId,
        villageId: request.villageId,
        recoveryRequestId: request.id,
        type,
        dedupeKey: recoveryDedupeKey(request.id, event, userId),
        params,
      });
    }
  };

  // Only while it is still waiting: an approver added later must not receive a
  // "requested" notice for a request that is already finished.
  if (request.status === "PENDING") {
    add(
      // Nobody is told to approve their own request.
      approverUserIds.filter((userId) => userId !== request.target.id),
      "RECOVERY_REQUESTED",
      "requested",
      {
        targetName: request.target.name,
        requestExpiresAt: iso(request.requestExpiresAt),
      },
    );
  }

  if (request.status === "REJECTED") {
    add([request.target.id], "RECOVERY_REJECTED", "rejected", {
      rejectedAt: iso(request.rejectedAt),
      rejectionNote: request.rejectionNote ?? "",
      rejectedByName: request.rejectedBy?.name ?? "",
      rejectedByRole: request.rejectedBy?.role ?? "",
    });
  }

  if (request.status === "COMPLETED") {
    // "By whom" and "who to contact": the person who issued the code.
    add([request.target.id], "RECOVERY_PASSWORD_CHANGED", "password-changed", {
      completedAt: iso(request.completedAt),
      issuedByName: request.issuedBy?.name ?? "",
      issuedByRole: request.issuedBy?.role ?? "",
    });

    if (request.issuedBy) {
      add([request.issuedBy.id], "RECOVERY_RESET_COMPLETED", "reset-completed", {
        targetName: request.target.name,
        completedAt: iso(request.completedAt),
      });
    }
  }

  return planned;
}
