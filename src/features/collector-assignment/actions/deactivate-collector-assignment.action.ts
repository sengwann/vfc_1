"use server";

import { redirect } from "next/navigation";
import { AuditActionType } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { requireChief, getCurrentPeriod } from "../../../lib/authz";
import { canDeactivateAssignment } from "../lib/collector-assignment-rules";
import { getPeriodStatus } from "../lib/collector-period";
import { AuditEntityType, createAuditLog } from "../../../lib/audit";
import { beginHouseholdWrite } from "@/features/household-management/lib/household-write";
import { acquireVillageScopes } from "@/lib/db/village-scope";
import { withSerializableRetry } from "@/lib/db/transaction";
import { TransactionAuthorityError } from "@/lib/authz/transaction-authority";
import { LOGIN_ROUTE, CHANGE_PASSWORD_ROUTE } from "@/lib/auth/auth.constants";
import { redirectForbidden } from "../../../lib/authz/authz.errors";
import { withReadOnlyError } from "../../village-deactivation/lib/village-deactivation-rules";

function getFormDataString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function deactivateCollectorAssignmentAction(
  formData: FormData,
): Promise<void> {
  const { user, villageId } = await requireChief();

  const assignmentId = getFormDataString(formData, "assignmentId");
  if (!assignmentId) {
    redirect("/village/collectors");
  }

  let outcome: "done" | "village_read_only" | "village_inactive";
  try {
    outcome = await withSerializableRetry(() => prisma.$transaction(async (tx) => {
      // Tenant discovery only, under the scope and before any entity locks.
      // beginHouseholdWrite re-enters this SAME held scope and acquires the
      // standard Village/Fund/House/ordered User locks; no scope is added late.
      await acquireVillageScopes(tx, [villageId]);
      const discovery = await tx.collectorAssignment.findFirst({
        where: { id: assignmentId, villageId }, select: { userId: true },
      });
      const guard = await beginHouseholdWrite(tx, {
        villageId, permission: "chief", actorUserId: user.id,
        targetUserIds: discovery ? [discovery.userId] : [],
      });
      if (!guard.ok) return guard.reason === "VILLAGE_READ_ONLY"
        ? "village_read_only" as const : "village_inactive" as const;
      if (!discovery) return "done" as const;
      await tx.$queryRaw`SELECT id FROM public."CollectorAssignment"
        WHERE id=${assignmentId} AND "villageId"=${villageId} AND "userId"=${discovery.userId}
        ORDER BY id FOR UPDATE`;
      const assignment = await tx.collectorAssignment.findFirst({
        where: { id: assignmentId, villageId, userId: discovery.userId },
        select: { id: true, isActive: true, year: true, month: true, userId: true,
          user: { select: { name: true, membershipStatus: true, villageId: true } } },
      });
      if (!assignment || assignment.user.villageId !== villageId) return "done" as const;
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      const periodStatus = getPeriodStatus(assignment.year, assignment.month, getCurrentPeriod(clock.now));
      // Inactive members may still need assignment revocation; do not require
      // ACTIVE membership to perform this cleanup.
      if (!canDeactivateAssignment(assignment.isActive, periodStatus)) return "done" as const;

      const result = await tx.collectorAssignment.updateMany({
        where: {
          id: assignment.id,
          villageId,
          userId: assignment.userId,
          isActive: true,
        },
        data: { isActive: false },
      });

      // Another request already deactivated it. Skip the audit write so a
      // double submit does not create duplicate audit entries.
      if (result.count === 0) {
        return "done" as const;
      }

      await createAuditLog(tx, {
        actionType: AuditActionType.STATUS_CHANGE,
        entityType: AuditEntityType.COLLECTOR_ASSIGNMENT,
        entityId: assignment.id,
        villageId,
        actorUserId: user.id,
        metadata: {
          year: assignment.year,
          month: assignment.month,
          isActive: false,
          assignedUserId: assignment.userId,
          assignedUserName: assignment.user.name,
        },
      });

      return "done" as const;
    }, { isolationLevel: "Serializable" }));
  } catch (error) {
    if (error instanceof TransactionAuthorityError) {
      if (error.code === "VFC_AUTH_SESSION") return redirect(LOGIN_ROUTE);
      if (error.code === "VFC_AUTH_PASSWORD_CHANGE") return redirect(CHANGE_PASSWORD_ROUTE);
      return redirectForbidden();
    }
    throw error;
  }

  if (outcome === "village_read_only") {
    redirect(withReadOnlyError("/village/collectors"));
  }

  if (outcome === "village_inactive") {
    return redirectForbidden();
  }

  redirect("/village/collectors");
}
