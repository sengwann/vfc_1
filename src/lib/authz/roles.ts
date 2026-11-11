import "server-only";

import { UserRole, VillageStatus } from "@prisma/client";

import { prisma } from "../prisma";
import { requireAuthenticatedUser } from "../auth/guards";
import type { SessionUser } from "../auth/auth.types";

import { redirectForbidden } from "./authz.errors";
import { hasActiveMembership, requireVillageContext } from "./context";
import type { VillageContext } from "./authz.types";

export function isSystemAdmin(user: SessionUser): boolean {
  return user.role === UserRole.SYSTEM_ADMIN;
}

export function isChief(user: SessionUser): boolean {
  return user.role === UserRole.CHIEF;
}

export function isVillager(user: SessionUser): boolean {
  return user.role === UserRole.VILLAGER;
}

export async function requireSystemAdmin(): Promise<SessionUser> {
  const user = await requireAuthenticatedUser();

  if (!isSystemAdmin(user)) {
    return redirectForbidden();
  }

  return user;
}

export async function requireChief(): Promise<VillageContext> {
  const context = await requireVillageContext();

  if (!isChief(context.user) || !hasActiveMembership(context.user)) {
    return redirectForbidden();
  }

  // Defensive: chiefs must not assign/deactivate in an inactive village.
  // Verify with guards.ts before removing this if it becomes redundant.
  const village = await prisma.village.findUnique({
    where: { id: context.villageId },
    select: { status: true },
  });

  if (village?.status !== VillageStatus.ACTIVE) {
    return redirectForbidden();
  }

  return context;
}

export async function requireVillager(): Promise<VillageContext> {
  const context = await requireVillageContext();

  if (!isVillager(context.user) || !hasActiveMembership(context.user)) {
    return redirectForbidden();
  }

  return context;
}

export async function requireVillageUser(): Promise<VillageContext> {
  return requireVillageContext();
}
