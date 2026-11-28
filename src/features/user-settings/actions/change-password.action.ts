"use server";
import { AuditActionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { destroySession, getSessionIdentity } from "@/lib/auth/session";
import { revokeRecoveryAfterPasswordReplacement } from "@/features/password-recovery/lib/recovery-credential-lock";
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

  const failed: ChangePasswordActionResult = {
    success: false,
    formError: "Unable to change password. Please try again.",
  };
  const identity = await getSessionIdentity();
  if (!identity || identity.userId !== user.id) return failed;

  const { currentPassword, newPassword } = validation.data;
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true, sessionVersion: true },
  });
  if (!dbUser || dbUser.sessionVersion !== identity.sessionVersion) return failed;

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
    const changed = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.updateMany({
        where: {
          id: identity.userId,
          sessionVersion: identity.sessionVersion,
          passwordHash: dbUser.passwordHash,
        },
        data: {
          passwordHash: newPasswordHash,
          mustChangePassword: false,
          sessionVersion: { increment: 1 },
        },
      });

      if (updated.count !== 1) return false;

      await revokeRecoveryAfterPasswordReplacement(tx, user.id);
      await createAuditLog(tx, {
        actionType: AuditActionType.UPDATE,
        entityType: AuditEntityType.USER,
        entityId: user.id,
        villageId: user.villageId ?? null,
        actorUserId: user.id,
        metadata: { note: "password_changed" },
      });
      return true;
    }, { isolationLevel: "ReadCommitted" });
    if (!changed) return failed;
  } catch {
    return failed;
  }

  await destroySession();
  return { success: true };
}
