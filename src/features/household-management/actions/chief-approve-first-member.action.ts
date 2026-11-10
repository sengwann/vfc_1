"use server";

import { beginHouseholdWrite } from "@/features/household-management/lib/household-write";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  AuditActionType,
  MembershipStatus,
  Prisma,
  UserRole,
} from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { withSerializableRetry } from "../../../lib/db/transaction";
import {
  VILLAGE_READ_ONLY_CODE,
  withReadOnlyError,
} from "../../village-deactivation/lib/village-deactivation-rules";
import { requireChief } from "../../../lib/authz/roles";
import { revalidateVillageShell } from "../../shell/lib/shell-revalidation";
import { AuditEntityType, createAuditLog } from "../../../lib/audit";
import { canChiefApproveFirstMember } from "../lib/chief-membership-rules";

function getFormDataString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/**
 * Chief approves one pending member of an active, headless house.
 * The member becomes ACTIVE and Head of House in one transaction.
 */
export async function chiefApproveFirstMemberAction(
  formData: FormData,
): Promise<void> {
  const { user, villageId } = await requireChief();

  const houseId = getFormDataString(formData, "houseId");
  const memberId = getFormDataString(formData, "memberId");

  if (!houseId) {
    redirect("/village/houses");
  }

  const detailPath = `/village/houses/${houseId}`;

  if (!memberId) {
    redirect(detailPath);
  }

  const house = await prisma.house.findFirst({
    where: {
      id: houseId,
      villageId,
    },
    select: {
      id: true,
      isActive: true,
      headOfHouseId: true,
    },
  });

  if (!house) {
    redirect("/village/houses");
  }

  const target = await prisma.user.findFirst({
    where: {
      id: memberId,
      houseId: house.id,
      villageId,
    },
    select: {
      id: true,
      role: true,
      membershipStatus: true,
    },
  });

  if (!target || !canChiefApproveFirstMember(target, house, user.id)) {
    redirect(detailPath);
  }

  try {
    await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const guard = await beginHouseholdWrite(tx, { villageId: villageId, permission: "chief", actorUserId: user.id, houseIds: [house.id], targetUserIds: [target.id] });

          if (!guard.ok) {
            throw new Error(guard.reason);
          }

          // B05 hardening: village-then-house lock ordering. Lock the house
          // row before claiming head-of-house and activating the member so
          // this cannot race a concurrent house deactivation.
          const lockedHouse = await tx.house.findFirst({ where: { id: house.id, villageId: villageId } });

          if (!lockedHouse) {
            throw new Error("HOUSE_ALREADY_HAS_HEAD");
          }

          const claimed = await tx.house.updateMany({
            where: {
              id: house.id,
              villageId,
              isActive: true,
              headOfHouseId: null,
            },
            data: {
              headOfHouseId: target.id,
            },
          });

          if (claimed.count !== 1) {
            throw new Error("HOUSE_ALREADY_HAS_HEAD");
          }

          const updated = await tx.user.updateMany({
            where: {
              id: target.id,
              houseId: house.id,
              villageId,
              role: UserRole.VILLAGER,
              membershipStatus: MembershipStatus.PENDING,
            },
            data: {
              membershipStatus: MembershipStatus.ACTIVE,
            },
          });

          if (updated.count !== 1) {
            throw new Error("INVALID_MEMBERSHIP_STATE");
          }

          await createAuditLog(tx, {
            actionType: AuditActionType.APPROVE,
            entityType: AuditEntityType.USER,
            entityId: target.id,
            villageId,
            actorUserId: user.id,
            metadata: {
              previousMembershipStatus: MembershipStatus.PENDING,
              newMembershipStatus: MembershipStatus.ACTIVE,
              houseId: house.id,
              assignedHeadOfHouse: true,
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
      redirect(withReadOnlyError(detailPath));
    }

    redirect(detailPath);
  }

  revalidateVillageShell();
  revalidatePath(detailPath);
  revalidatePath("/village/household");

  redirect(detailPath);
}
