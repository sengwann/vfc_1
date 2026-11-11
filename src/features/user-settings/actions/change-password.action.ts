"use server";
import { AuditActionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { destroySession, revokeUserSessions } from "@/lib/auth/session";
import { requireSessionUser } from "@/lib/auth/guards";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { AuditEntityType, createAuditLog } from "@/lib/audit";
import {
  validatePasswordInput,
  type PasswordField,
} from "../lib/settings-validators";

export type ChangePasswordActionResult =
  | { success: true }
  | {
      success: false;
      formError?: string;
      fieldErrors?: Partial<Record<PasswordField, string>>;
    };

export async function changePasswordAction(
  formData: FormData,
): Promise<ChangePasswordActionResult> {
  // Gate-exempt on purpose: a Chief with an initial password may only reach
  // this action (and logout) until the password is replaced.
  const user = await requireSessionUser();
  const validation = validatePasswordInput(formData);
  if (!validation.ok) {
    return {
      success: false,
      fieldErrors: validation.fieldErrors,
      formError: validation.formError,
    };
  }

  const { currentPassword, newPassword } = validation.data;
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, passwordHash: true },
  });

  if (!dbUser) {
    return {
      success: false,
      formError: "Unable to verify account. Please try again.",
    };
  }

  if (!(await verifyPassword(currentPassword, dbUser.passwordHash))) {
    return {
      success: false,
      fieldErrors: {
        currentPassword: "Current password is incorrect.",
      },
    };
  }

  const newPasswordHash = await hashPassword(newPassword);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash: newPasswordHash,
          mustChangePassword: false,
          sessionVersion: { increment: 1 },
        },
      });

      await createAuditLog(tx, {
        actionType: AuditActionType.UPDATE,
        entityType: AuditEntityType.USER,
        entityId: user.id,
        villageId: user.villageId ?? null,
        actorUserId: user.id,
        metadata: { note: "password_changed" },
      });
    });
  } catch {
    return {
      success: false,
      formError: "Unable to change password. Please try again.",
    };
  }

  await destroySession();
  return { success: true };
}
