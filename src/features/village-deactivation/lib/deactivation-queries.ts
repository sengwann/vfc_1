import "server-only";

import { cache } from "react";

import { prisma } from "../../../lib/prisma";
import {
  countUnreadNotifications,
  listNotificationsForUser,
} from "./deactivation-notifications";

/*
 * Read-only queries for the deactivation pages and the shell. They never write.
 * Page visibility is not a security boundary: every mutation re-checks against
 * the database in its own transaction.
 */

const REQUEST_SELECT = {
  id: true,
  status: true,
  reason: true,
  createdAt: true,
  approvedAt: true,
  scheduledDeactivationAt: true,
  rejectedAt: true,
  rejectionReason: true,
  cooldownEndsAt: true,
  cancelledAt: true,
  cancellationReason: true,
  completedAt: true,
} as const;

/** The village's open (PENDING or APPROVED) request, for the read-only banner and shell. */
export const getOpenDeactivationRequest = cache(async (villageId: string) =>
  prisma.villageDeactivationRequest.findFirst({
    where: { villageId, status: { in: ["PENDING", "APPROVED"] } },
    select: REQUEST_SELECT,
  }),
);

export async function getChiefDeactivationView(villageId: string) {
  const [village, open, lastResolved] = await Promise.all([
    prisma.village.findUnique({
      where: { id: villageId },
      select: { status: true },
    }),
    getOpenDeactivationRequest(villageId),
    prisma.villageDeactivationRequest.findFirst({
      where: {
        villageId,
        status: { in: ["REJECTED", "CANCELLED", "COMPLETED"] },
      },
      orderBy: { createdAt: "desc" },
      select: REQUEST_SELECT,
    }),
  ]);

  return { villageStatus: village?.status ?? null, open, lastResolved };
}

export async function listAdminDeactivationRequests() {
  const include = {
    ...REQUEST_SELECT,
    lastProcessingError: true,
    village: { select: { id: true, name: true, villageCode: true, status: true } },
    requester: { select: { name: true } },
  } as const;

  const [open, recent] = await Promise.all([
    prisma.villageDeactivationRequest.findMany({
      where: { status: { in: ["PENDING", "APPROVED"] } },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      select: include,
    }),
    prisma.villageDeactivationRequest.findMany({
      where: { status: { in: ["REJECTED", "CANCELLED", "COMPLETED"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: include,
    }),
  ]);

  return { open, recent };
}

export function countPendingDeactivationRequests(): Promise<number> {
  return prisma.villageDeactivationRequest.count({
    where: { status: "PENDING" },
  });
}

export async function getNotificationsView(userId: string) {
  const [items, unread] = await Promise.all([
    listNotificationsForUser(prisma, userId, 20),
    countUnreadNotifications(prisma, userId),
  ]);

  return { items, unread };
}
