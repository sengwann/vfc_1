/*
 * Pure planning of the in-app notifications for a deactivation request. No
 * imports, so it can be unit tested directly.
 *
 * Notifications are DERIVED from the request's stored state, not from the
 * action that just ran. That makes delivery idempotent and self-healing: the
 * same plan can be computed after the transition, again by the worker, or after
 * a failed attempt, and every notification carries a dedupe key, so storing a
 * plan twice never creates a duplicate.
 *
 *   request created      -> System Admins
 *   approved             -> the Chief(s)
 *   rejected             -> the Chief(s), with the reason and cooldown end
 *   cancelled            -> System Admins
 *   completed            -> System Admins only (village users are blocked by then)
 *   reminders (T-12h, T-1h, configurable, while APPROVED) -> Chief(s) and System Admins
 *
 * The text is not stored. `params` carries the values the page needs to render
 * translated text when the notification is read.
 */

export type DeactivationNotificationType =
  | "DEACTIVATION_REQUESTED"
  | "DEACTIVATION_APPROVED"
  | "DEACTIVATION_REJECTED"
  | "DEACTIVATION_CANCELLED"
  | "DEACTIVATION_COMPLETED"
  | "DEACTIVATION_REMINDER";

export interface PlanRequest {
  id: string;
  villageId: string;
  status: string;
  reason: string;
  approvedAt: Date | null;
  scheduledDeactivationAt: Date | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;
  cooldownEndsAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  completedAt: Date | null;
}

export interface PlannedNotification {
  userId: string;
  villageId: string;
  requestId: string;
  type: DeactivationNotificationType;
  dedupeKey: string;
  params: Record<string, string | number>;
}

export function dedupeKey(
  requestId: string,
  event: string,
  userId: string,
): string {
  return `deact:${requestId}:${event}:${userId}`;
}

function iso(date: Date | null): string {
  return date ? date.toISOString() : "";
}

export function planDeactivationNotifications(input: {
  request: PlanRequest;
  village: { name: string; villageCode: string };
  /** Every System Admin. */
  adminUserIds: readonly string[];
  /** The village's current Chief(s). */
  chiefUserIds: readonly string[];
  now: Date;
  /** Reminder offsets before the deadline, in milliseconds. */
  reminderOffsetsMs: readonly number[];
}): PlannedNotification[] {
  const { request, village, adminUserIds, chiefUserIds, now } = input;
  const planned: PlannedNotification[] = [];

  const base = {
    villageName: village.name,
    villageCode: village.villageCode,
  };

  const add = (
    userIds: readonly string[],
    type: DeactivationNotificationType,
    event: string,
    params: Record<string, string | number>,
  ) => {
    for (const userId of new Set(userIds)) {
      planned.push({
        userId,
        villageId: request.villageId,
        requestId: request.id,
        type,
        dedupeKey: dedupeKey(request.id, event, userId),
        params: { ...base, ...params },
      });
    }
  };

  add(adminUserIds, "DEACTIVATION_REQUESTED", "requested", {
    reason: request.reason,
  });

  if (request.approvedAt) {
    add(chiefUserIds, "DEACTIVATION_APPROVED", "approved", {
      approvedAt: iso(request.approvedAt),
      scheduledDeactivationAt: iso(request.scheduledDeactivationAt),
    });
  }

  if (request.rejectedAt) {
    add(chiefUserIds, "DEACTIVATION_REJECTED", "rejected", {
      rejectionReason: request.rejectionReason ?? "",
      cooldownEndsAt: iso(request.cooldownEndsAt),
    });
  }

  if (request.cancelledAt) {
    add(adminUserIds, "DEACTIVATION_CANCELLED", "cancelled", {
      cancellationReason: request.cancellationReason ?? "",
      cancelledAt: iso(request.cancelledAt),
    });
  }

  if (request.completedAt) {
    // System Admins only: village users no longer have access.
    add(adminUserIds, "DEACTIVATION_COMPLETED", "completed", {
      completedAt: iso(request.completedAt),
    });
  }

  if (request.status === "APPROVED" && request.scheduledDeactivationAt) {
    const deadline = request.scheduledDeactivationAt.getTime();

    if (now.getTime() < deadline) {
      for (const offset of input.reminderOffsetsMs) {
        // Due once the reminder moment has passed; a reminder missed while the
        // worker was down is still sent until the deadline.
        if (now.getTime() >= deadline - offset) {
          add(
            [...chiefUserIds, ...adminUserIds],
            "DEACTIVATION_REMINDER",
            `reminder-${offset}`,
            {
              scheduledDeactivationAt: iso(request.scheduledDeactivationAt),
              offsetMinutes: Math.round(offset / 60000),
            },
          );
        }
      }
    }
  }

  return planned;
}
