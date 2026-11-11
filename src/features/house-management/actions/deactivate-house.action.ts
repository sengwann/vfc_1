"use server";

import { assertHouseNotAssessed, beginHouseholdWrite } from "@/features/household-management/lib/household-write";

import { redirect, notFound } from "next/navigation";
import { LOGIN_ROUTE, CHANGE_PASSWORD_ROUTE } from "@/lib/auth/auth.constants";
import { TransactionAuthorityError } from "@/lib/authz/transaction-authority";
import { AuditActionType, MembershipStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireChief } from "@/lib/authz";
import { redirectForbidden } from "@/lib/authz/authz.errors";
import { withReadOnlyError } from "@/features/village-deactivation/lib/village-deactivation-rules";
import { canDeactivateHouse } from "../lib/house-rules";
import { AuditEntityType, createAuditLog } from "@/lib/audit";
import { withSerializableRetry } from "@/lib/db/transaction";

type DeactivateOutcome =
  | { kind: "found"; houseId: string }
  | { kind: "not_found" }
  | { kind: "village_inactive" }
  | { kind: "village_read_only" };

export async function deactivateHouseAction(houseId: string): Promise<void> {
  const { user, villageId } = await requireChief();

  // A blocked deactivation is not an error: the detail page shows why.
  let outcome: DeactivateOutcome;

  try {
    outcome = await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx): Promise<DeactivateOutcome> => {
          const guard = await beginHouseholdWrite(tx, { villageId: villageId, permission: "chief", actorUserId: user.id, houseIds: [houseId] });

          if (!guard.ok) {
            return guard.reason === "VILLAGE_READ_ONLY"
              ? { kind: "village_read_only" }
              : { kind: "village_inactive" };
          }

          // beginHouseholdWrite already acquired the scope and ordered row locks.
          // This read retrieves the current state under those held locks.
          const lockedHouse = await tx.house.findFirst({ where: { id: houseId, villageId } });

          if (!lockedHouse) {
            return { kind: "not_found" };
          }

          const house = await tx.house.findUnique({
            where: { id: houseId },
            select: {
              id: true,
              villageId: true,
              houseNumber: true,
              isActive: true,
              members: {
                where: {
                  membershipStatus: {
                    in: [MembershipStatus.ACTIVE, MembershipStatus.PENDING],
                  },
                },
                select: { id: true },
              },
            },
          });

          if (!house || house.villageId !== villageId) {
            return { kind: "not_found" };
          }

          await assertHouseNotAssessed(tx, villageId, house.id);

          const rules = canDeactivateHouse({
            isActive: house.isActive,
            hasActiveOrPendingMembers: house.members.length > 0,
          });

          if (!rules.allowed) {
            return { kind: "found", houseId: house.id };
          }

          await tx.house.update({
            where: {
              id: house.id,
              villageId,
              isActive: true,
            },
            data: { isActive: false },
          });

          await createAuditLog(tx, {
            actionType: AuditActionType.STATUS_CHANGE,
            entityType: AuditEntityType.HOUSE,
            entityId: house.id,
            villageId,
            actorUserId: user.id,
            metadata: {
              houseNumber: house.houseNumber,
              isActive: false,
            },
          });

          return { kind: "found", houseId: house.id };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  } catch (error) {
    // Map permanent authority failures after the whole transaction has aborted.
    // Unknown errors (including framework navigation signals) keep their identity.
    if (error instanceof TransactionAuthorityError) {
      if (error.code === "VFC_AUTH_SESSION") return redirect(LOGIN_ROUTE);
      if (error.code === "VFC_AUTH_PASSWORD_CHANGE") return redirect(CHANGE_PASSWORD_ROUTE);
      return redirectForbidden();
    }
    if ((error as { code?: string })?.code === "VFC_LOCK_TARGET_NOT_FOUND") return notFound();
    // P2025: the house changed (for example already deactivated) between the
    // read and the write. Show the current state instead of an error page.
    if ((error as { code?: string })?.code === "P2025" || (error instanceof Error && error.message === "HOUSE_ACTIVE_FUND_ASSESSMENT")) {
      return redirect(`/village/houses/${houseId}`);
    }
    throw error;
  }

  if (outcome.kind === "village_read_only") {
    return redirect(withReadOnlyError(`/village/houses/${houseId}`));
  }

  if (outcome.kind === "village_inactive") {
    return redirectForbidden();
  }

  if (outcome.kind === "not_found") {
    return notFound();
  }

  redirect(`/village/houses/${outcome.houseId}`);
}
