import "server-only";

import { notFound } from "next/navigation";

import { prisma } from "../prisma";

import { requireSystemAdmin } from "./roles";
import type { VillageLifecycleContext } from "./authz.types";

export async function requireVillageLifecycleAccess(
  villageId: string,
): Promise<VillageLifecycleContext> {
  await requireSystemAdmin();

  const village = await prisma.village.findUnique({
    where: {
      id: villageId,
    },
    select: {
      id: true,
      villageCode: true,
      name: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!village) {
    return notFound();
  }

  return village;
}

export { guardVillageWrite } from "./village-write-guard";
