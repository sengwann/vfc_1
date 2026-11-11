import "server-only";

import { VillageStatus } from "@prisma/client";

import { prisma } from "../prisma";
import { requireAuthenticatedUser } from "../auth/guards";
import type { SessionUser } from "../auth/auth.types";

import { redirectForbidden } from "./authz.errors";
import { getVillageContext, hasActiveMembership } from "./context";
import type { CollectorContext } from "./authz.types";

import { getCurrentPeriod } from "./collector-period";
export { getCurrentPeriod } from "./collector-period";

async function isVillageActive(villageId: string): Promise<boolean> {
  const village = await prisma.village.findUnique({
    where: { id: villageId },
    select: { status: true },
  });

  return village?.status === VillageStatus.ACTIVE;
}

export async function getActiveCollectorContext(
  user: SessionUser,
): Promise<CollectorContext | null> {
  const villageContext = getVillageContext(user);

  if (!villageContext) {
    return null;
  }

  if (!hasActiveMembership(user)) {
    return null;
  }

  // Defensive: if guards.ts does not already block inactive villages,
  // this prevents collectors from continuing to collect cash there.
  if (!(await isVillageActive(villageContext.villageId))) {
    return null;
  }

  const { year, month } = getCurrentPeriod();

  const assignment = await prisma.collectorAssignment.findFirst({
    where: {
      userId: user.id,
      villageId: villageContext.villageId,
      year,
      month,
      isActive: true,
    },
    select: {
      id: true,
      villageId: true,
      year: true,
      month: true,
    },
  });

  if (!assignment) {
    return null;
  }

  if (assignment.villageId !== villageContext.villageId) {
    return null;
  }

  return {
    user,
    villageId: villageContext.villageId,
    assignment: {
      id: assignment.id,
      villageId: assignment.villageId,
      year: assignment.year,
      month: assignment.month,
    },
  };
}

export async function requireActiveCollector(): Promise<CollectorContext> {
  const user = await requireAuthenticatedUser();

  const context = await getActiveCollectorContext(user);

  if (!context) {
    return redirectForbidden();
  }

  return context;
}
