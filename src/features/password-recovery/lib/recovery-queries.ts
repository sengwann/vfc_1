import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { evaluateAuthority, type AuthorityActor } from "./recovery-authority";
import {
  isActiveRecoveryStatus,
  isExpiryDue,
  type RecoveryMembershipStatus,
  type RecoveryRole,
  type RecoveryStatus,
  type RecoveryVillageStatus,
} from "./recovery-rules";

/*
 * Read side for the Chief and System Admin screens.
 *
 * Authority is never stored. Every list is worked out from current data: the
 * query narrows the rows, then evaluateAuthority decides for each one, so a
 * Chief who was removed sees nothing on the next load, and a village that lost
 * its last Chief shows up for the System Admins by itself.
 *
 * What a row exposes: the member's NAME, role and village, times, counters and
 * the notes. Never an email, a phone number, a code or a code hash. Those are
 * not needed to decide, and the Chief recognises a member by name.
 */

type Client = PrismaClient | Prisma.TransactionClient;

/** How far back finished requests stay visible. Open ones always show. */
const HISTORY_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 200;

export interface RecoveryRequestView {
  id: string;
  /** What to show: a PENDING or CODE_ISSUED request that ran out of time reads EXPIRED. */
  status: RecoveryStatus;
  targetName: string;
  targetRole: RecoveryRole;
  villageCode: string | null;
  createdAt: Date;
  requestExpiresAt: Date;
  codeIssuedAt: Date | null;
  codeExpiresAt: Date | null;
  issueCount: number;
  rejectionNote: string | null;
  revocationReason: string | null;
  revocationNote: string | null;
  canIssue: boolean;
  canReject: boolean;
  canWithdraw: boolean;
  /** Who the viewer is acting as, for the screen's wording. */
  actingAs: "VILLAGE_CHIEF" | "SYSTEM_ADMIN";
}

async function loadViewer(
  client: Client,
  userId: string,
): Promise<AuthorityActor | null> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      villageId: true,
      membershipStatus: true,
      village: { select: { status: true } },
    },
  });

  if (!user) {
    return null;
  }

  return {
    id: user.id,
    role: user.role as RecoveryRole,
    villageId: user.villageId,
    membershipStatus: user.membershipStatus as RecoveryMembershipStatus | null,
    villageStatus:
      (user.village?.status as RecoveryVillageStatus | undefined) ?? null,
  };
}

/**
 * The requests this person may act on, newest first. Anyone who is not an
 * active Chief or a System Admin gets an empty list.
 */
export async function listRecoveryRequestsForApprover(
  client: Client,
  params: { userId: string; now: Date },
): Promise<RecoveryRequestView[]> {
  const viewer = await loadViewer(client, params.userId);

  if (!viewer) {
    return [];
  }

  const isChief =
    viewer.role === "CHIEF" &&
    viewer.membershipStatus === "ACTIVE" &&
    viewer.villageStatus === "ACTIVE" &&
    viewer.villageId !== null;

  if (!isChief && viewer.role !== "SYSTEM_ADMIN") {
    return [];
  }

  const recently: Prisma.PasswordRecoveryRequestWhereInput = {
    OR: [
      { status: { in: ["PENDING", "CODE_ISSUED"] } },
      { createdAt: { gte: new Date(params.now.getTime() - HISTORY_DAYS * DAY_MS) } },
    ],
  };

  const rows = await client.passwordRecoveryRequest.findMany({
    where: {
      AND: [
        recently,
        // A Chief only ever sees their own village's members, and never anyone
        // else's: the narrowing below is repeated by evaluateAuthority.
        isChief
          ? { villageId: viewer.villageId, user: { role: "VILLAGER" } }
          : {},
      ],
    },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
    select: {
      id: true,
      userId: true,
      villageId: true,
      status: true,
      createdAt: true,
      requestExpiresAt: true,
      codeIssuedAt: true,
      codeExpiresAt: true,
      issueCount: true,
      rejectionNote: true,
      revocationReason: true,
      revocationNote: true,
      user: { select: { name: true, role: true } },
      village: { select: { villageCode: true } },
    },
  });

  // Active Chiefs per village, only for the villages Villager rows belong to.
  const villageIds = [
    ...new Set(
      rows
        .filter((row) => row.user.role === "VILLAGER" && row.villageId)
        .map((row) => row.villageId as string),
    ),
  ];

  const chiefGroups =
    villageIds.length === 0
      ? []
      : await client.user.groupBy({
          by: ["villageId"],
          where: {
            villageId: { in: villageIds },
            role: "CHIEF",
            membershipStatus: "ACTIVE",
            village: { is: { status: "ACTIVE" } },
          },
          _count: { _all: true },
        });

  const chiefCounts = new Map(
    chiefGroups.map((group) => [group.villageId, group._count._all]),
  );

  const views: RecoveryRequestView[] = [];

  for (const row of rows) {
    const decision = evaluateAuthority({
      actor: viewer,
      target: {
        id: row.userId,
        role: row.user.role as RecoveryRole,
        villageId: row.villageId,
      },
      activeChiefCountInTargetVillage: row.villageId
        ? (chiefCounts.get(row.villageId) ?? 0)
        : 0,
    });

    if (!decision.allowed) {
      continue;
    }

    const stored = row.status as RecoveryStatus;
    const status: RecoveryStatus = isExpiryDue(
      {
        status: stored,
        requestExpiresAt: row.requestExpiresAt,
        codeExpiresAt: row.codeExpiresAt,
      },
      params.now,
    )
      ? "EXPIRED"
      : stored;

    const open = isActiveRecoveryStatus(status);

    views.push({
      id: row.id,
      status,
      targetName: row.user.name,
      targetRole: row.user.role as RecoveryRole,
      villageCode: row.village?.villageCode ?? null,
      createdAt: row.createdAt,
      requestExpiresAt: row.requestExpiresAt,
      codeIssuedAt: row.codeIssuedAt,
      codeExpiresAt: row.codeExpiresAt,
      issueCount: row.issueCount,
      rejectionNote: row.rejectionNote,
      revocationReason: row.revocationReason,
      revocationNote: row.revocationNote,
      canIssue: open,
      canReject: status === "PENDING",
      canWithdraw: status === "CODE_ISSUED",
      actingAs: decision.as,
    });
  }

  return views;
}

/** How many requests are waiting for a decision from this person (the nav badge). */
export async function countPendingRecoveryRequestsForApprover(
  client: Client,
  params: { userId: string; now: Date },
): Promise<number> {
  const views = await listRecoveryRequestsForApprover(client, params);

  return views.filter((view) => view.status === "PENDING").length;
}
