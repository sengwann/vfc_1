"use server";

import { withSerializableRetry } from "@/lib/db/transaction";
import { beginHouseholdWrite } from "@/features/household-management/lib/household-write";

import { redirect, notFound } from "next/navigation";
import { LOGIN_ROUTE, CHANGE_PASSWORD_ROUTE } from "@/lib/auth/auth.constants";
import { TransactionAuthorityError } from "@/lib/authz/transaction-authority";
import { AuditActionType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireChief } from "@/lib/authz";
import { redirectForbidden } from "@/lib/authz/authz.errors";
import { withReadOnlyError } from "@/features/village-deactivation/lib/village-deactivation-rules";
import { canReactivateHouse } from "../lib/house-rules";
import { AuditEntityType, createAuditLog } from "@/lib/audit";

export async function reactivateHouseAction(houseId: string): Promise<void> {
  const { user, villageId } = await requireChief();

  const outcome = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const guard = await beginHouseholdWrite(tx, { villageId: villageId, permission: "chief", actorUserId: user.id, houseIds: [houseId] });

    if (!guard.ok) {
      return guard.reason === "VILLAGE_READ_ONLY"
        ? ("village_read_only" as const)
        : ("village_inactive" as const);
    }

    // Scoped by village: a house from another village looks like "not found".
    const house = await tx.house.findFirst({
      where: { id: houseId, villageId },
      select: { id: true, houseNumber: true, isActive: true },
    });

    if (!house) return "not_found" as const;

    const rules = canReactivateHouse({ isActive: house.isActive });
    if (!rules.allowed) return "noop" as const;

    // Guarded write: a double submit changes nothing the second time, so only
    // the request that really flipped the flag writes an audit entry.
    const { count } = await tx.house.updateMany({
      where: { id: house.id, villageId, isActive: false },
      data: { isActive: true },
    });

    if (count !== 1) return "noop" as const;

    await createAuditLog(tx, {
      actionType: AuditActionType.STATUS_CHANGE,
      entityType: AuditEntityType.HOUSE,
      entityId: house.id,
      villageId,
      actorUserId: user.id,
      metadata: {
        houseNumber: house.houseNumber,
        isActive: true,
      },
    });

    return "done" as const;
  }, { isolationLevel: "Serializable" })).catch((error: unknown) => {
    // Map permanent authority failures after the whole transaction has aborted.
    // Unknown errors (including framework navigation signals) keep their identity.
    if (error instanceof TransactionAuthorityError) {
      if (error.code === "VFC_AUTH_SESSION") return redirect(LOGIN_ROUTE);
      if (error.code === "VFC_AUTH_PASSWORD_CHANGE") return redirect(CHANGE_PASSWORD_ROUTE);
      return redirectForbidden();
    }
    if ((error as { code?: string })?.code === "VFC_LOCK_TARGET_NOT_FOUND") return "not_found" as const;
    throw error;
  });

  if (outcome === "village_read_only") {
    return redirect(withReadOnlyError(`/village/houses/${houseId}`));
  }

  if (outcome === "village_inactive") {
    return redirectForbidden();
  }

  if (outcome === "not_found") {
    return notFound();
  }

  redirect(`/village/houses/${houseId}`);
}
