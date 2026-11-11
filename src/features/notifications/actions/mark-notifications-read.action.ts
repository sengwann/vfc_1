"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";

import { requireAuthenticatedUser } from "../../../lib/auth/guards";
import { prisma } from "../../../lib/prisma";
import { markAllNotificationsRead } from "../../village-deactivation/lib/deactivation-notifications";
import {
  ADMIN_DEACTIVATION_PATH,
  CHIEF_DEACTIVATION_PATH,
} from "../../village-deactivation/lib/deactivation-results";

/**
 * Marks the signed-in user's own notifications as read. The user id comes from
 * the session, never from the form, so nobody can touch another user's
 * notifications. It changes only the reader's own read marks, not village
 * records, so it is allowed while a village is read-only.
 */
export async function markNotificationsReadAction(): Promise<void> {
  const user = await requireAuthenticatedUser();

  await markAllNotificationsRead(prisma, user.id, new Date());

  const path =
    user.role === UserRole.SYSTEM_ADMIN
      ? ADMIN_DEACTIVATION_PATH
      : CHIEF_DEACTIVATION_PATH;

  revalidatePath(path);
  redirect(path);
}
