import "server-only";

import { notFound } from "next/navigation";

import type { VillageContext } from "./authz.types";

export function isSameVillage(
  context: VillageContext,
  targetVillageId: string | null | undefined,
): boolean {
  if (!targetVillageId) {
    return false;
  }

  return context.villageId === targetVillageId;
}

export function assertSameVillage(
  context: VillageContext,
  targetVillageId: string | null | undefined,
): boolean {
  return isSameVillage(context, targetVillageId);
}

export function requireSameVillage(
  context: VillageContext,
  targetVillageId: string | null | undefined,
): void {
  if (!isSameVillage(context, targetVillageId)) {
    return notFound();
  }
}
