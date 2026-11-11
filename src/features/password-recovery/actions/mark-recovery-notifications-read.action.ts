"use server";

import { revalidatePath } from "next/cache";

import { requireAuthenticatedUser } from "../../../lib/auth/guards";
import { prisma } from "../../../lib/prisma";
import { markAllRecoveryNotificationsRead } from "../lib/recovery-notifications";

/**
 * Marks the signed-in user's OWN recovery notices as read. The user id comes
 * from the session, never from the form. It changes only the reader's read
 * marks, not village records.
 */
export async function markRecoveryNotificationsReadAction(): Promise<void> {
  const user = await requireAuthenticatedUser();

  await markAllRecoveryNotificationsRead(prisma, user.id, new Date());

  revalidatePath("/", "layout");
}
