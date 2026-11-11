import { AuditActionType, Prisma } from "@prisma/client";

import { AuditEntityType, createAuditLog } from "../../../lib/audit";
import {
  planDeactivationNotifications,
  type PlannedNotification,
} from "./deactivation-notifications-plan";
import { RECOVERY_NOTIFICATION_TYPES } from "../../password-recovery/lib/recovery-notifications-plan";

/*
 * Stores the in-app notifications for a deactivation request. Notifications are
 * informational: the database state is the source of truth, and nothing here
 * changes village or request state (rules, section 12.5 and 12.7). It must
 * therefore never throw into, delay the outcome of, or roll back a transition:
 * deliverDeactivationNotifications catches everything.
 *
 * Idempotent: every notification has a unique dedupe key, and the insert is
 * "skip duplicates", so running the same plan twice (a retry, the worker, a
 * double submit) stores each notification once. Retrying a failed delivery is
 * just running this again.
 */

type Client = Prisma.TransactionClient;

/*
 * The read helpers below belong to the DEACTIVATION family only. Password
 * recovery notifications live in the same table, so every query here excludes
 * them: they are not listed or counted here, and "mark as read" here can never
 * mark a recovery security notice as read.
 */
const NOT_RECOVERY = {
  type: { notIn: [...RECOVERY_NOTIFICATION_TYPES] },
} satisfies Prisma.NotificationWhereInput;

export interface SyncResult {
  planned: number;
  created: number;
}

/** Computes the plan from the stored state and stores whatever is missing. */
export async function syncDeactivationNotifications(
  client: Client,
  params: {
    requestId: string;
    now: Date;
    reminderOffsetsMs: readonly number[];
  },
): Promise<SyncResult> {
  const request = await client.villageDeactivationRequest.findUnique({
    where: { id: params.requestId },
    select: {
      id: true,
      villageId: true,
      status: true,
      reason: true,
      approvedAt: true,
      scheduledDeactivationAt: true,
      rejectedAt: true,
      rejectionReason: true,
      cooldownEndsAt: true,
      cancelledAt: true,
      cancellationReason: true,
      completedAt: true,
    },
  });

  if (!request) {
    return { planned: 0, created: 0 };
  }

  const [village, admins, chiefs] = await Promise.all([
    client.village.findUnique({
      where: { id: request.villageId },
      select: { name: true, villageCode: true },
    }),
    client.user.findMany({
      where: { role: "SYSTEM_ADMIN" },
      select: { id: true },
    }),
    client.user.findMany({
      where: {
        villageId: request.villageId,
        role: "CHIEF",
        membershipStatus: "ACTIVE",
      },
      select: { id: true },
    }),
  ]);

  if (!village) {
    return { planned: 0, created: 0 };
  }

  const planned = planDeactivationNotifications({
    request,
    village,
    adminUserIds: admins.map((row) => row.id),
    chiefUserIds: chiefs.map((row) => row.id),
    now: params.now,
    reminderOffsetsMs: params.reminderOffsetsMs,
  });

  if (planned.length === 0) {
    return { planned: 0, created: 0 };
  }

  const result = await client.notification.createMany({
    data: planned.map(toRow),
    skipDuplicates: true,
  });

  return { planned: planned.length, created: result.count };
}

function toRow(item: PlannedNotification) {
  return {
    userId: item.userId,
    villageId: item.villageId,
    requestId: item.requestId,
    type: item.type,
    params: item.params as Prisma.InputJsonValue,
    dedupeKey: item.dedupeKey,
  };
}

export interface DeliveryDeps {
  now?: () => Date;
  reminderOffsetsMs: readonly number[];
  log?: (message: string, error: unknown) => void;
}

/**
 * Never throws. A failure is logged and, where the audit write itself works,
 * recorded in the audit log (rules, section 10: delivery outcomes where
 * operationally relevant). The transition that triggered it is unaffected, and
 * the worker's next pass stores whatever is still missing.
 */
export async function deliverDeactivationNotifications(
  client: Client,
  requestId: string,
  event: string,
  deps: DeliveryDeps,
): Promise<SyncResult | null> {
  try {
    return await syncDeactivationNotifications(client, {
      requestId,
      now: (deps.now ?? (() => new Date()))(),
      reminderOffsetsMs: deps.reminderOffsetsMs,
    });
  } catch (error) {
    (deps.log ?? defaultLog)("Deactivation notification delivery failed", error);

    try {
      await createAuditLog(client, {
        actionType: AuditActionType.UPDATE,
        entityType: AuditEntityType.DEACTIVATION_REQUEST,
        entityId: requestId,
        metadata: {
          requestId,
          notificationDelivery: "FAILED",
          notificationEvent: event,
          error: String((error as Error)?.message ?? error).slice(0, 200),
        },
      });
    } catch {
      // The audit write is best effort too; delivery must not fail the workflow.
    }

    return null;
  }
}

function defaultLog(message: string, error: unknown): void {
  console.error(message, error);
}

// ------------------------------------------------------------- read side

export interface StoredNotification {
  id: string;
  type: string;
  params: unknown;
  readAt: Date | null;
  createdAt: Date;
  requestId: string | null;
  villageId: string | null;
}

/** Notifications of one user, newest first. Scoped by userId: never another user's. */
export function listNotificationsForUser(
  client: Client,
  userId: string,
  take = 50,
): Promise<StoredNotification[]> {
  return client.notification.findMany({
    where: { userId, ...NOT_RECOVERY },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      type: true,
      params: true,
      readAt: true,
      createdAt: true,
      requestId: true,
      villageId: true,
    },
  });
}

export function countUnreadNotifications(
  client: Client,
  userId: string,
): Promise<number> {
  return client.notification.count({
    where: { userId, readAt: null, ...NOT_RECOVERY },
  });
}

/**
 * Marks the given notifications of this user as read. The userId is part of the
 * WHERE, so ids belonging to someone else are ignored.
 */
export async function markNotificationsRead(
  client: Client,
  userId: string,
  notificationIds: readonly string[],
  now: Date,
): Promise<number> {
  const result = await client.notification.updateMany({
    where: {
      userId,
      id: { in: [...notificationIds] },
      readAt: null,
      ...NOT_RECOVERY,
    },
    data: { readAt: now },
  });

  return result.count;
}

/** Marks every unread notification of this user as read. */
export async function markAllNotificationsRead(
  client: Client,
  userId: string,
  now: Date,
): Promise<number> {
  const result = await client.notification.updateMany({
    where: { userId, readAt: null, ...NOT_RECOVERY },
    data: { readAt: now },
  });

  return result.count;
}
