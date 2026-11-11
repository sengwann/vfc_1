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
import { revalidateVillageShell } from "../../shell/lib/shell-revalidation";
import { canRejectPendingMember } from "../lib/membership-rules";
import { AuditEntityType, createAuditLog } from "../../../lib/audit";

function getFormDataString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function rejectMemberAction(formData: FormData): Promise<void> {
  const { user, house } = await requireHouseholdManagementAccess();

  const memberId = getFormDataString(formData, "memberId");
  if (!memberId) {
    redirect("/village/household");
  }

  const target = await prisma.user.findFirst({
    where: {
      id: memberId,
      houseId: house.id,
      villageId: house.villageId,
    },
    select: {
      id: true,
      membershipStatus: true,
    },
  });

  if (!target || !canRejectPendingMember(target, house, user.id)) {
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

          const updated = await tx.user.updateMany({
            where: {
              id: target.id,
              houseId: currentHouse.id,
              villageId: house.villageId,
              membershipStatus: MembershipStatus.PENDING,
              NOT: { id: user.id },
            },
            data: {
              membershipStatus: MembershipStatus.REJECTED,
            },
          });

          if (updated.count !== 1) {
            throw new Error("INVALID_MEMBERSHIP_STATE");
          }

          await createAuditLog(tx, {
            actionType: AuditActionType.REJECT,
            entityType: AuditEntityType.USER,
            entityId: target.id,
            villageId: house.villageId,
            actorUserId: user.id,
            metadata: {
              previousMembershipStatus: MembershipStatus.PENDING,
              newMembershipStatus: MembershipStatus.REJECTED,
              houseId: house.id,
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

  revalidateVillageShell();
  redirect("/village/household");
}
