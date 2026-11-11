"use server";

import {
  AuditActionType,
  MembershipStatus,
  Prisma,
  UserRole,
} from "@prisma/client";
import { withSerializableRetry } from "../../../lib/db/transaction";
import { prisma } from "../../../lib/prisma";
import { requireChief, getCurrentPeriod } from "../../../lib/authz";
import {
  validateAssignCollectorInput,
  type AssignCollectorField,
} from "../lib/collector-assignment-validators";
import { AuditEntityType, createAuditLog } from "../../../lib/audit";
import { acquireVillageScopes } from "@/lib/db/village-scope";
import { beginHouseholdWrite } from "@/features/household-management/lib/household-write";
import { TransactionAuthorityError } from "@/lib/authz/transaction-authority";
import { redirect } from "next/navigation";
import { redirectForbidden } from "@/lib/authz/authz.errors";
import { LOGIN_ROUTE, CHANGE_PASSWORD_ROUTE } from "@/lib/auth/auth.constants";
import {
  VILLAGE_READ_ONLY_CODE,
  VILLAGE_READ_ONLY_MESSAGE,
  type VillageReadOnlyCode,
} from "../../village-deactivation/lib/village-deactivation-rules";

export type AssignCollectorActionResult =
  | { success: true }
  | {
      success: false;
      formError?: string;
      /** Set when the village is read-only (approved deactivation). */
      code?: VillageReadOnlyCode;
      fieldErrors?: Partial<Record<AssignCollectorField, string>>;
    };

// Chiefs are not eligible collectors (owner decision).
const NOT_CHIEF = { not: UserRole.CHIEF } as const;

export async function assignCollectorAction(
  formData: FormData,
): Promise<AssignCollectorActionResult> {
  const { user, villageId } = await requireChief();
  const currentPeriod = getCurrentPeriod();

  const validation = validateAssignCollectorInput(formData, currentPeriod);
  if (!validation.ok) {
    return {
      success: false,
      fieldErrors: validation.fieldErrors,
      formError: validation.formError,
    };
  }

  const { userId, year, month } = validation.data;

  let assignmentId: string | undefined;

  try {
    const result = await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          // Discover target identity under the scope; the shared entry then
          // re-enters the same scope and locks all Users together in ID order.
          await acquireVillageScopes(tx, [villageId]);
          const discovery = await tx.user.findFirst({
            where: { id: userId, villageId }, select: { id: true },
          });
          const guard = await beginHouseholdWrite(tx, {
            villageId, permission: "chief", actorUserId: user.id,
            targetUserIds: discovery ? [discovery.id] : [],
          });

          if (!guard.ok) {
            throw new Error(guard.reason);
          }

          const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
          const currentValidation = validateAssignCollectorInput(formData, getCurrentPeriod(clock.now));
          if (!currentValidation.ok) return currentValidation;

          const activeTarget = await tx.user.findFirst({
            where: {
              id: userId,
              villageId,
              membershipStatus: MembershipStatus.ACTIVE,
              role: NOT_CHIEF,
            },
            select: { id: true, name: true },
          });

          if (!activeTarget) {
            throw new Error("TARGET_USER_NOT_ELIGIBLE");
          }

          // Users are already locked in ID order; acquire all relevant
          // assignment rows together before making uniqueness decisions.
          await tx.$queryRaw`SELECT id FROM public."CollectorAssignment"
            WHERE "villageId"=${villageId} AND year=${year} AND month=${month}
            ORDER BY id FOR UPDATE`;
          const existingActiveAssignment =
            await tx.collectorAssignment.findFirst({
              where: {
                villageId,
                year,
                month,
                isActive: true,
              },
              select: {
                id: true,
                userId: true,
              },
            });

          if (existingActiveAssignment) {
            if (existingActiveAssignment.userId === userId) {
              throw new Error("SAME_USER_ALREADY_ACTIVE_COLLECTOR");
            }

            throw new Error("ACTIVE_COLLECTOR_ALREADY_EXISTS");
          }

          const existingInactiveAssignment =
            await tx.collectorAssignment.findUnique({
              where: {
                villageId_userId_year_month: {
                  villageId,
                  userId,
                  year,
                  month,
                },
              },
              select: {
                id: true,
                isActive: true,
              },
            });

          let createdAssignmentId: string;

          if (existingInactiveAssignment) {
            const reactivated = await tx.collectorAssignment.updateMany({
              where: {
                id: existingInactiveAssignment.id,
                villageId, userId, year, month,
                isActive: false, // <-- ဒီ guard က အဓိက
              },
              data: { isActive: true },
            });

            // တခြား request က အရင် reactivate လုပ်ပြီးသား (သို့) တခြား user
            // အတွက် active row တစ်ခု ဖြစ်နေပြီ။
            if (reactivated.count === 0) {
              throw new Error("ACTIVE_COLLECTOR_ALREADY_EXISTS");
            }

            createdAssignmentId = existingInactiveAssignment.id;
          } else {
            const created = await tx.collectorAssignment.create({
              data: {
                villageId,
                userId,
                year,
                month,
                isActive: true,
              },
            });

            createdAssignmentId = created.id;
          }

          await createAuditLog(tx, {
            actionType: AuditActionType.ASSIGN,
            entityType: AuditEntityType.COLLECTOR_ASSIGNMENT,
            entityId: createdAssignmentId,
            villageId,
            actorUserId: user.id,
            metadata: {
              year,
              month,
              isActive: true,
              assignedUserId: userId,
              assignedUserName: activeTarget.name,
            },
          });
          return { ok: true as const, assignmentId: createdAssignmentId };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      ),
    );
    if (!result.ok) return { success: false, fieldErrors: result.fieldErrors, formError: result.formError };
    assignmentId = result.assignmentId;
  } catch (error) {
    if (error instanceof TransactionAuthorityError) {
      if (error.code === "VFC_AUTH_SESSION") return redirect(LOGIN_ROUTE);
      if (error.code === "VFC_AUTH_PASSWORD_CHANGE") return redirect(CHANGE_PASSWORD_ROUTE);
      return redirectForbidden();
    }
    if (error instanceof Error) {
      if (error.message === VILLAGE_READ_ONLY_CODE) {
        return {
          success: false,
          formError: VILLAGE_READ_ONLY_MESSAGE,
          code: VILLAGE_READ_ONLY_CODE,
        };
      }

      if (error.message === "TARGET_USER_NOT_ELIGIBLE") {
        return {
          success: false,
          fieldErrors: {
            userId: "Selected user is not an active member of this village.",
          },
        };
      }

      if (error.message === "SAME_USER_ALREADY_ACTIVE_COLLECTOR") {
        return {
          success: false,
          formError:
            "This user is already the active Collector for the selected period.",
        };
      }

      if (error.message === "ACTIVE_COLLECTOR_ALREADY_EXISTS") {
        return {
          success: false,
          formError:
            "An active Collector already exists for the selected period. Deactivate the existing assignment first.",
        };
      }
    }

    // P2002 = unique constraint violation. With the partial index
    // (villageId, year, month) WHERE isActive = true, this means another
    // request created an active assignment for the same period in parallel.
    const prismaError = error as { code?: string };
    if (prismaError?.code === "P2002") {
      return {
        success: false,
        formError:
          "An active Collector already exists for the selected period. Deactivate the existing assignment first.",
      };
    }

    return {
      success: false,
      formError: "Unable to assign collector. Please try again.",
    };
  }

  if (!assignmentId) {
    return {
      success: false,
      formError: "Unable to assign collector. Please try again.",
    };
  }

  return { success: true };
}
