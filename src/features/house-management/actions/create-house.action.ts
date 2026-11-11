"use server";

import { withSerializableRetry } from "@/lib/db/transaction";
import { beginHouseholdWrite } from "@/features/household-management/lib/household-write";

import { AuditActionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireChief } from "@/lib/authz";
import { redirectForbidden } from "@/lib/authz/authz.errors";
import { VILLAGE_READ_ONLY_CODE } from "@/features/village-deactivation/lib/village-deactivation-rules";
import { validateHouseNumber, type HouseField } from "../lib/house-validators";
import type { HouseErrorCode } from "../lib/house-error-text";
import { AuditEntityType, createAuditLog } from "@/lib/audit";

export type CreateHouseActionResult =
  | { success: true; houseId: string }
  | {
      success: false;
      /** "generic" means: show the translated generic error in the form. */
      formError?: "generic";
      /** Set when the village is read-only (approved deactivation). */
      code?: typeof VILLAGE_READ_ONLY_CODE;
      fieldErrors?: Partial<Record<HouseField, HouseErrorCode>>;
    };

export async function createHouseAction(
  formData: FormData,
): Promise<CreateHouseActionResult> {
  const { user, villageId } = await requireChief();
  const rawHouseNumber = formData.get("houseNumber");
  const validation = validateHouseNumber(
    typeof rawHouseNumber === "string" ? rawHouseNumber : "",
  );

  if (!validation.ok) {
    return { success: false, fieldErrors: validation.fieldErrors };
  }

  const { houseNumber } = validation.data;

  let outcome:
    | { kind: "created"; houseId: string }
    | { kind: "village_inactive" }
    | { kind: "village_read_only" };

  try {
    outcome = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      // Village must still be ACTIVE when the write happens, not only when
      // the request started.
      const guard = await beginHouseholdWrite(tx, { villageId: villageId, permission: "chief", actorUserId: user.id });

      if (!guard.ok) {
        return guard.reason === "VILLAGE_READ_ONLY"
          ? ({ kind: "village_read_only" } as const)
          : ({ kind: "village_inactive" } as const);
      }

      const createdHouse = await tx.house.create({
        data: { villageId, houseNumber, isActive: true },
      });

      await createAuditLog(tx, {
        actionType: AuditActionType.CREATE,
        entityType: AuditEntityType.HOUSE,
        entityId: createdHouse.id,
        villageId,
        actorUserId: user.id,
        metadata: { houseNumber, isActive: true },
      });

      return { kind: "created", houseId: createdHouse.id } as const;
    }, { isolationLevel: "Serializable" }));
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2002") {
      return {
        success: false,
        fieldErrors: { houseNumber: "duplicate" },
      };
    }
    return { success: false, formError: "generic" };
  }

  if (outcome.kind === "village_read_only") {
    return { success: false, formError: "generic", code: VILLAGE_READ_ONLY_CODE };
  }

  if (outcome.kind === "village_inactive") {
    return redirectForbidden();
  }

  return { success: true, houseId: outcome.houseId };
}
