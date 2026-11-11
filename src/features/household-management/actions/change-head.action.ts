"use server";

import { beginHouseholdWrite } from "@/features/household-management/lib/household-write";

import { redirect } from "next/navigation";
import { AuditActionType, MembershipStatus, Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { withSerializableRetry } from "../../../lib/db/transaction";
import {
  VILLAGE_READ_ONLY_CODE,
  withReadOnlyError,
} from "../../village-deactivation/lib/village-deactivation-rules";
import { requireHouseholdManagementAccess } from "../lib/household-access";
import { canChangeHeadOfHouse } from "../lib/membership-rules";
import { AuditEntityType, createAuditLog } from "../../../lib/audit";

function getFormDataString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function changeHeadAction(formData: FormData): Promise<void> {
  const { user, house } = await requireHouseholdManagementAccess();

  const targetUserId = getFormDataString(formData, "targetUserId");
  if (!targetUserId) {
    redirect("/village/household");
  }

  const target = await prisma.user.findFirst({
    where: {
      id: targetUserId,
      houseId: house.id,
      villageId: house.villageId,
    },
    select: {
      id: true,
      membershipStatus: true,
    },
  });

  if (!target || !canChangeHeadOfHouse(target, house, user.id)) {
    redirect("/village/household");
  }

  try {
    await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const guard = await beginHouseholdWrite(tx, { villageId: house.villageId, permission: "head", actorUserId: user.id, houseIds: [house.id], targetUserIds: [target.id] });

          if (!guard.ok) {
            throw new Error(guard.reason);
          }

          const currentHouse = await tx.house.findFirst({
            where: {
              id: house.id,
              villageId: house.villageId,
              isActive: true,
              headOfHouseId: user.id,
            },
            select: { id: true },
          });

          if (!currentHouse) {
            throw new Error("HOUSEHOLD_ACCESS_CHANGED");
          }

          const activeTarget = await tx.user.findFirst({
            where: {
              id: target.id,
              houseId: currentHouse.id,
              villageId: house.villageId,
              membershipStatus: MembershipStatus.ACTIVE,
              NOT: { id: user.id },
            },
            select: { id: true },
          });

          if (!activeTarget) {
            throw new Error("INVALID_HEAD_TARGET");
          }

          const updated = await tx.house.updateMany({
            where: {
              id: currentHouse.id,
              villageId: house.villageId,
              isActive: true,
              headOfHouseId: user.id,
            },
            data: {
              headOfHouseId: activeTarget.id,
            },
          });

          if (updated.count !== 1) {
            throw new Error("INVALID_HEAD_CHANGE");
          }

          await createAuditLog(tx, {
            actionType: AuditActionType.STATUS_CHANGE,
            entityType: AuditEntityType.HOUSE,
            entityId: currentHouse.id,
            villageId: house.villageId,
            actorUserId: user.id,
            metadata: {
              previousHeadOfHouseId: user.id,
              newHeadOfHouseId: activeTarget.id,
              houseId: currentHouse.id,
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      ),
    );
  } catch (error) {
    if (error instanceof Error && error.message === VILLAGE_READ_ONLY_CODE) {
      redirect(withReadOnlyError("/village/household"));
    }

    redirect("/village/household");
  }

  redirect("/village/household");
}
