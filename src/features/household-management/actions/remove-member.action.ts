"use server";

import { beginHouseholdWrite } from "@/features/household-management/lib/household-write";

import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { getCurrentPeriod } from "@/lib/authz/collector-period";
import {
  VILLAGE_READ_ONLY_CODE,
  withReadOnlyError,
} from "../../village-deactivation/lib/village-deactivation-rules";
import { withSerializableRetry } from "../../../lib/db/transaction";
import { revalidateVillageShell } from "../../shell/lib/shell-revalidation";
import { requireHouseholdManagementAccess } from "../lib/household-access";
import { canRemoveActiveMember } from "../lib/membership-rules";
import {
  REMOVE_MEMBER_ERROR,
  removeMemberAndDeactivateAssignments,
} from "../lib/remove-member-transaction";

const KNOWN_REMOVE_MEMBER_ERRORS = new Set<string>(
  Object.values(REMOVE_MEMBER_ERROR),
);

function getFormDataString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value === "string") {
    return value;
  }
  return "";
}

export async function removeMemberAction(formData: FormData): Promise<void> {
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

  if (!target || !canRemoveActiveMember(target, house, user.id)) {
    redirect("/village/household");
  }

  let removed = false;
  let readOnly = false;

  // redirect() works by throwing, so it must stay outside this try/catch.
  try {
    await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const guard = await beginHouseholdWrite(tx, { villageId: house.villageId, permission: "head", actorUserId: user.id, houseIds: [house.id], targetUserIds: [target.id], deactivateAssignmentsFor: target.id });

          if (!guard.ok) {
            throw new Error(guard.reason);
          }

          await removeMemberAndDeactivateAssignments(tx, {
            actorUserId: user.id,
            houseId: house.id,
            villageId: house.villageId,
            targetUserId: target.id,
            currentPeriod: getCurrentPeriod(),
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      ),
    );
    removed = true;
  } catch (error) {
    // Expected race outcomes (head changed, member already removed) are
    // handled silently, like the other household actions. Anything else is
    // logged so a real failure is not hidden.
    const message = error instanceof Error ? error.message : "";

    readOnly = message === VILLAGE_READ_ONLY_CODE;

    // Read-only and an inactive village are expected outcomes of the guard.
    const isKnown =
      readOnly ||
      message === "VILLAGE_INACTIVE" ||
      KNOWN_REMOVE_MEMBER_ERRORS.has(message);

    if (!isKnown) {
      console.error("removeMemberAction failed", error);
    }
  }

  if (removed) {
    revalidateVillageShell();
  }

  if (readOnly) {
    redirect(withReadOnlyError("/village/household"));
  }

  redirect("/village/household");
}
