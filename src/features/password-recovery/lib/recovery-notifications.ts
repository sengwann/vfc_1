import { AuditActionType, type Prisma, type PrismaClient } from "@prisma/client";

import { AuditEntityType, createAuditLog } from "../../../lib/audit";
import { approverGroupFor } from "./recovery-authority";
import {
  planRecoveryNotifications,
  RECOVERY_NOTIFICATION_TYPES,
  type PlannedRecoveryNotification,
  type PlanPerson,
  type RecoveryNotificationType,
} from "./recovery-notifications-plan";

/*
 * Stores the in-app notifications for a password recovery request, from the
 * request's STORED state (see recovery-notifications-plan.ts for what is sent
 * to whom). Same approach as the deactivation notifications:
 *
 *  - idempotent: every notification has a unique dedupe key and the insert is
 *    "skip duplicates", so running this twice stores each notice once;
 *  - the member's "password changed" notice is stored INSIDE the redeem
 *    transaction (syncRecoveryNotifications with only: [PASSWORD_CHANGED]), so a
 *    reset can never commit without it. If that insert fails, the whole reset
 *    rolls back, which is the intended behaviour for a security notice;
 *  - everything else is stored after commit by deliverRecoveryNotifications,
 *    which never throws, so a notification problem cannot undo a decision.
 */

type Client = Prisma.TransactionClient;

export interface RecoverySyncResult {
  planned: number;
  created: number;
}

function asPerson(
  user: { id: string; name: string; role: string } | null,
): PlanPerson | null {
  if (!user || (user.role !== "CHIEF" && user.role !== "SYSTEM_ADMIN")) {
    return null;
  }

  return { id: user.id, name: user.name, role: user.role };
}

/** The users who can act on a PENDING request right now (never the target). */
async function findApproverUserIds(
  client: Client,
  target: { id: string; role: string; villageId: string | null },
): Promise<string[]> {
  const activeChiefWhere = (villageId: string): Prisma.UserWhereInput => ({
    villageId,
    role: "CHIEF",
    membershipStatus: "ACTIVE",
    village: { is: { status: "ACTIVE" } },
  });

  const chiefCount =
    target.role === "VILLAGER" && target.villageId
      ? await client.user.count({ where: activeChiefWhere(target.villageId) })
      : 0;

  const group = approverGroupFor({
    target: {
      id: target.id,
      role: target.role as "SYSTEM_ADMIN" | "CHIEF" | "VILLAGER",
      villageId: target.villageId,
    },
    activeChiefCountInTargetVillage: chiefCount,
  });

  const where: Prisma.UserWhereInput =
    group === "VILLAGE_CHIEFS" && target.villageId
      ? activeChiefWhere(target.villageId)
      : { role: "SYSTEM_ADMIN", id: { not: target.id } };

  const rows = await client.user.findMany({ where, select: { id: true } });

  return rows.map((row) => row.id);
}

export async function syncRecoveryNotifications(
  client: Client,
  params: { requestId: string; only?: readonly RecoveryNotificationType[] },
): Promise<RecoverySyncResult> {
  const request = await client.passwordRecoveryRequest.findUnique({
    where: { id: params.requestId },
    select: {
      id: true,
      villageId: true,
      status: true,
      requestExpiresAt: true,
      rejectionNote: true,
      rejectedAt: true,
      completedAt: true,
      user: { select: { id: true, name: true, role: true, villageId: true } },
      codeIssuedBy: { select: { id: true, name: true, role: true } },
      rejectedBy: { select: { id: true, name: true, role: true } },
    },
  });

  if (!request) {
    return { planned: 0, created: 0 };
  }

  const approverUserIds =
    request.status === "PENDING"
      ? await findApproverUserIds(client, {
          id: request.user.id,
          role: request.user.role,
          villageId: request.villageId,
        })
      : [];

  const all = planRecoveryNotifications({
    request: {
      id: request.id,
      villageId: request.villageId,
      status: request.status,
      requestExpiresAt: request.requestExpiresAt,
      rejectionNote: request.rejectionNote,
      rejectedAt: request.rejectedAt,
      completedAt: request.completedAt,
      target: { id: request.user.id, name: request.user.name },
      issuedBy: asPerson(request.codeIssuedBy),
      rejectedBy: asPerson(request.rejectedBy),
    },
    approverUserIds,
  });

  const planned = params.only
    ? all.filter((item) => params.only?.includes(item.type))
    : all;

  if (planned.length === 0) {
    return { planned: 0, created: 0 };
  }

  const result = await client.notification.createMany({
    data: planned.map(toRow),
    skipDuplicates: true,
  });

  return { planned: planned.length, created: result.count };
}

function toRow(item: PlannedRecoveryNotification) {
  return {
    userId: item.userId,
    villageId: item.villageId,
    recoveryRequestId: item.recoveryRequestId,
    type: item.type,
    params: item.params as Prisma.InputJsonValue,
    dedupeKey: item.dedupeKey,
  };
}

/**
 * Post-commit, best effort. Never throws. A failure is logged (the error text
 * only, which never contains a code or password) and, where the audit write
 * works, recorded in the audit log.
 */
export async function deliverRecoveryNotifications(
  client: Client,
  requestId: string,
  event: string,
  log: (message: string, error: unknown) => void = defaultLog,
): Promise<RecoverySyncResult | null> {
  try {
    return await syncRecoveryNotifications(client, { requestId });
  } catch (error) {
    log("Recovery notification delivery failed", error);

    try {
      await createAuditLog(client, {
        actionType: AuditActionType.UPDATE,
        entityType: AuditEntityType.PASSWORD_RECOVERY_REQUEST,
        entityId: requestId,
        metadata: {
          requestId,
          notificationDelivery: "FAILED",
          notificationEvent: event,
          error: String((error as Error)?.message ?? error).slice(0, 200),
        },
      });
    } catch {
      // Best effort too: delivery must never fail the workflow.
    }

    return null;
  }
}

function defaultLog(message: string, error: unknown): void {
  console.error(message, error);
}

/* ------------------------------------------------------------- read side */

/*
 * Mirror image of the deactivation helpers: these see ONLY recovery
 * notifications, and the user id always comes from the session.
 */

const ONLY_RECOVERY = {
  type: { in: [...RECOVERY_NOTIFICATION_TYPES] },
} satisfies Prisma.NotificationWhereInput;

export function listRecoveryNotificationsForUser(
  client: Client | PrismaClient,
  userId: string,
  take = 20,
) {
  return client.notification.findMany({
    where: { userId, ...ONLY_RECOVERY },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      type: true,
      params: true,
      readAt: true,
      createdAt: true,
    },
  });
}

export function countUnreadRecoveryNotifications(
  client: Client | PrismaClient,
  userId: string,
): Promise<number> {
  return client.notification.count({
    where: { userId, readAt: null, ...ONLY_RECOVERY },
  });
}

export async function markAllRecoveryNotificationsRead(
  client: Client | PrismaClient,
  userId: string,
  now: Date,
): Promise<number> {
  const result = await client.notification.updateMany({
    where: { userId, readAt: null, ...ONLY_RECOVERY },
    data: { readAt: now },
  });

  return result.count;
}
