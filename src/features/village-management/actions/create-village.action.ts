"use server";

import {
  AuditActionType,
  MembershipStatus,
  UserRole,
  VillageStatus,
  type Prisma,
} from "@prisma/client";
import { acquireVillageScopes } from "@/lib/db/village-scope";
import { hasLifecycleAuthority } from "../lib/lifecycle-authority";
import { prisma } from "../../../lib/prisma";
import { requireSystemAdmin } from "../../../lib/authz";
import { hashPassword } from "../../../lib/auth/password";
import {
  validateCreateVillageInput,
  type CreateVillageFieldErrors,
} from "../lib/village-validators";
import type { CreateVillageFormErrorCode } from "../lib/village-validation-rules";
import { AuditEntityType, createAuditLog } from "../../../lib/audit";
import {
  isSerializationConflict,
  withSerializableRetry,
} from "../../../lib/db/transaction";

export type CreateVillageActionResult =
  | {
      success: true;
      villageId: string;
    }
  | {
      success: false;
      formError?: CreateVillageFormErrorCode;
      fieldErrors?: CreateVillageFieldErrors;
    };

type CreateVillageTransactionResult =
  | {
      ok: true;
      villageId: string;
    }
  | {
      ok: false;
      fieldErrors: CreateVillageFieldErrors;
    };

/*
 * Reads inside the same transaction, so a duplicate village code is reported
 * without depending on the shape of the database driver's unique-violation
 * error. The P2002 handling below remains as the fallback for a race.
 *
 * Email and phone are unique PER VILLAGE and this village does not exist yet,
 * so the Chief's identifiers cannot conflict with anyone. They are not checked
 * here; the database constraints still enforce it.
 */
async function findConflicts(
  tx: Prisma.TransactionClient,
  input: { villageCode: string },
): Promise<CreateVillageFieldErrors> {
  const fieldErrors: CreateVillageFieldErrors = {};

  const village = await tx.village.findUnique({
    where: { villageCode: input.villageCode },
    select: { id: true },
  });

  if (village) {
    fieldErrors.villageCode = "CODE_EXISTS";
  }

  return fieldErrors;
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;

    return typeof code === "string" ? code : undefined;
  }

  return undefined;
}

/*
 * Text used to work out which unique constraint fired. Only the `meta` object
 * and the final "Unique constraint failed ..." sentence are used: the earlier
 * part of a Prisma message echoes the whole `create()` call, which names every
 * column and would match the wrong field.
 */
function getUniqueViolationText(error: unknown): string {
  const parts: string[] = [];

  if (error instanceof Error) {
    const message = error.message;
    const marker = message
      .toLowerCase()
      .lastIndexOf("unique constraint failed");

    if (marker >= 0) {
      parts.push(message.slice(marker));
    }
  }

  const meta = (error as { meta?: unknown } | null)?.meta;

  if (meta !== undefined) {
    try {
      parts.push(JSON.stringify(meta));
    } catch {
      // Ignore a meta value that cannot be serialized.
    }
  }

  return parts.join(" ").toLowerCase();
}

function mapUniqueViolation(error: unknown): CreateVillageActionResult {
  const text = getUniqueViolationText(error);

  if (text.includes("villagecode")) {
    return { success: false, fieldErrors: { villageCode: "CODE_EXISTS" } };
  }

  if (text.includes("email")) {
    return { success: false, fieldErrors: { chiefEmail: "EMAIL_EXISTS" } };
  }

  if (text.includes("phone")) {
    return { success: false, fieldErrors: { chiefPhone: "PHONE_EXISTS" } };
  }

  return { success: false, formError: "EXISTS" };
}

/*
 * Server-side log without the full Prisma message: a failed create() echoes
 * its arguments, which include the password hash.
 */
function logUnexpectedError(error: unknown): void {
  const lastLine =
    error instanceof Error
      ? error.message.trim().split("\n").pop()?.slice(0, 200)
      : undefined;

  console.error("[createVillageAction] failed", {
    name: error instanceof Error ? error.name : typeof error,
    code: getErrorCode(error),
    detail: lastLine,
  });
}

export async function createVillageAction(
  formData: FormData,
): Promise<CreateVillageActionResult> {
  const admin = await requireSystemAdmin();

  const validation = validateCreateVillageInput(formData);

  if (!validation.ok) {
    return {
      success: false,
      fieldErrors: validation.fieldErrors,
    };
  }

  const {
    villageCode,
    villageName,
    chiefName,
    chiefEmail,
    chiefPhone,
    chiefPassword,
  } = validation.data;

  const passwordHash = await hashPassword(chiefPassword);

  try {
    const result = await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx): Promise<CreateVillageTransactionResult> => {
          const conflicts = await findConflicts(tx, { villageCode });

          if (Object.keys(conflicts).length > 0) {
            return { ok: false, fieldErrors: conflicts };
          }

          const newVillage = await tx.village.create({
            data: {
              villageCode,
              name: villageName,
              status: VillageStatus.ACTIVE,
            },
          });

          // AFTER INSERT bootstrap owns the internal row; never write it directly.
          await acquireVillageScopes(tx, [newVillage.id]);
          if (!(await hasLifecycleAuthority(tx, admin.id, "SYSTEM_ADMIN"))) throw new Error("VFC_AUTH_ROLE");
          const chief = await tx.user.create({
            data: {
              name: chiefName,
              email: chiefEmail,
              phone: chiefPhone,
              passwordHash,
              role: UserRole.CHIEF,
              villageId: newVillage.id,
              houseId: null,
              membershipStatus: MembershipStatus.ACTIVE,
              // The password was typed by the System Admin, so the Chief must
              // replace it before using anything (enforced server-side).
              mustChangePassword: true,
            },
            select: {
              id: true,
            },
          });

          await createAuditLog(tx, {
            actionType: AuditActionType.CREATE,
            entityType: AuditEntityType.VILLAGE,
            entityId: newVillage.id,
            villageId: newVillage.id,
            actorUserId: admin.id,
            metadata: {
              villageCode,
              name: villageName,
              newStatus: VillageStatus.ACTIVE,
              chiefUserId: chief.id,
            },
          });

          // No email or phone here: audit entries are visible to the village.
          await createAuditLog(tx, {
            actionType: AuditActionType.CREATE,
            entityType: AuditEntityType.USER,
            entityId: chief.id,
            villageId: newVillage.id,
            actorUserId: admin.id,
            metadata: {
              name: chiefName,
              role: UserRole.CHIEF,
              newMembershipStatus: MembershipStatus.ACTIVE,
            },
          });

          return { ok: true, villageId: newVillage.id };
        },
        {
          isolationLevel: "Serializable",
        },
      ),
    );

    if (!result.ok) {
      return {
        success: false,
        fieldErrors: result.fieldErrors,
      };
    }

    return {
      success: true,
      villageId: result.villageId,
    };
  } catch (error) {
    const code = getErrorCode(error);

    if (code === "P2002") {
      return mapUniqueViolation(error);
    }

    logUnexpectedError(error);

    // Covers Prisma 6 P2034 and the Prisma 7 adapter-pg write conflict.
    if (isSerializationConflict(error)) {
      return { success: false, formError: "RETRY" };
    }

    return { success: false, formError: "GENERIC" };
  }
}
