import "server-only";

import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";

import { requireAuthenticatedUser } from "../auth/guards";
import type { SessionUser } from "../auth/auth.types";

export async function requireVillageResource(
  resource:
    | {
        villageId: string;
      }
    | null
    | undefined,
): Promise<void> {
  // Signed in AND past the forced password change; redirects otherwise.
  const user = await requireAuthenticatedUser();

  if (user.role === UserRole.SYSTEM_ADMIN || !user.villageId) {
    notFound();
    return;
  }

  if (!resource || resource.villageId !== user.villageId) {
    notFound();
    return;
  }
}

export async function requireResourceOwner(
  resourceUserId: string | null | undefined,
): Promise<SessionUser> {
  const user = await requireAuthenticatedUser();

  if (!resourceUserId || resourceUserId !== user.id) {
    notFound();
    return undefined as never;
  }

  return user;
}

export async function requireVillageAndOwner(
  resource:
    | {
        villageId: string;
        userId: string;
      }
    | null
    | undefined,
): Promise<void> {
  if (!resource) {
    return notFound();
  }

  await requireVillageResource(resource);
  await requireResourceOwner(resource.userId);
}
