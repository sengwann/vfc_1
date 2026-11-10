"use server";

import {
  AuditActionType,
  MembershipStatus,
  Prisma,
  UserRole,
  VillageStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/db/transaction";
import { hashPassword } from "@/lib/auth/password";
import { getClientIp } from "@/lib/auth/client-ip";
import { reserveSignupAttempt } from "@/lib/auth/login-throttle";
import {
  getUserIdentifierViolation,
  isUniqueViolation,
} from "@/lib/db/unique-violation";
import { beginHouseholdWrite } from "@/features/household-management/lib/household-write";
import {
  VILLAGE_READ_ONLY_CODE,
  VILLAGE_READ_ONLY_MESSAGE,
  type VillageReadOnlyCode,
} from "@/features/village-deactivation/lib/village-deactivation-rules";
import { revalidateVillageShell } from "../../shell/lib/shell-revalidation";
import {
  validateRegisterInput,
  type RegisterField,
} from "../lib/registration-validators";
import { AuditEntityType, createAuditLog } from "@/lib/audit";

export type RegisterVillagerActionResult =
  | {
      success: true;
      redirectTo: string;
    }
  | {
      success: false;
      formError?: string;
      /** Set when the village is read-only (approved deactivation). */
      code?: VillageReadOnlyCode;
      fieldErrors?: Partial<Record<RegisterField, string>>;
    };

class RegistrationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationInputError";
  }
}

class VillageReadOnlyError extends Error {
  constructor() {
    super(VILLAGE_READ_ONLY_CODE);
    this.name = "VillageReadOnlyError";
  }
}

export async function registerVillagerAction(
  formData: FormData,
): Promise<RegisterVillagerActionResult> {
  // Throttled before validation and before the bcrypt hash, so repeated
  // requests from one address stay cheap for the server.
  const throttle = await reserveSignupAttempt(prisma, {
    clientIp: await getClientIp(),
  });
  if (throttle.blocked) {
    return {
      success: false,
      formError: "Too many attempts. Please try again later.",
    };
  }

  const validation = validateRegisterInput(formData);
  if (!validation.ok) {
    return {
      success: false,
      fieldErrors: validation.fieldErrors,
      formError: validation.formError,
    };
  }

  const {
    villageCode,
    name,
    email,
    phone,
    password,
    houseNumber,
    dateOfBirth,
  } = validation.data;

  const passwordHash = await hashPassword(password);

  try {
    await withSerializableRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const village = await tx.village.findUnique({
            where: {
              villageCode,
            },
            select: {
              id: true,
              status: true,
            },
          });

          if (!village || village.status !== VillageStatus.ACTIVE) {
            throw new RegistrationInputError("Invalid village code.");
          }

          // Canonical guard: takes the village lock and refuses while the
          // village has an approved deactivation request (read-only).
          const guard = await beginHouseholdWrite(tx, { villageId: village.id, permission: "registration", houseNumber });

          if (!guard.ok) {
            if (guard.reason === "VILLAGE_READ_ONLY") {
              throw new VillageReadOnlyError();
            }

            throw new RegistrationInputError("Invalid village code.");
          }

          const house = await tx.house.findUnique({
            where: {
              villageId_houseNumber: {
                villageId: village.id,
                houseNumber,
              },
            },
            select: {
              id: true,
            },
          });

          if (!house) {
            throw new RegistrationInputError(
              "Selected house is not available.",
            );
          }

          // B05 hardening: lock the house row BEFORE creating the PENDING
          // membership, and treat the locked row's isActive as authoritative.
          // This serializes signup against concurrent house deactivation.
          // Lock-ordering note: the village guard above takes the village row
          // lock first, then this house lock, as every other flow does.
          const lockedHouse = await tx.house.findFirst({ where: { id: house.id, villageId: village.id }, select: { id: true, isActive: true } });

          if (!lockedHouse || !lockedHouse.isActive) {
            throw new RegistrationInputError(
              "Selected house is not available.",
            );
          }

          // Every new registrant is PENDING and is never made Head of House
          // here. If the house has a head, that head approves the request.
          // If the house has no head yet, the Village Chief decides (see the
          // chief approve/reject actions in household-management).
          const membershipStatus = MembershipStatus.PENDING;

          const user = await tx.user.create({
            data: {
              name,
              email,
              phone,
              passwordHash,
              role: UserRole.VILLAGER,
              villageId: village.id,
              houseId: house.id,
              membershipStatus,
              dateOfBirth,
            },
          });

          await createAuditLog(tx, {
            actionType: AuditActionType.CREATE,
            entityType: AuditEntityType.USER,
            entityId: user.id,
            villageId: village.id,
            actorUserId: user.id,
            metadata: {
              name,
              email,
              phone,
              role: UserRole.VILLAGER,
              newMembershipStatus: membershipStatus,
              houseId: house.id,
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      ),
    );

    revalidateVillageShell();
    return {
      success: true,
      redirectTo: `/login?registered=1&village=${encodeURIComponent(villageCode)}`,
    };
  } catch (error) {
    if (error instanceof VillageReadOnlyError) {
      return {
        success: false,
        formError: VILLAGE_READ_ONLY_MESSAGE,
        code: VILLAGE_READ_ONLY_CODE,
      };
    }

    if (error instanceof RegistrationInputError) {
      return {
        success: false,
        formError: error.message,
      };
    }

    if (isUniqueViolation(error)) {
      // Email and phone are unique per village, so this only means the
      // address or number is already used inside THIS village.
      const field = getUserIdentifierViolation(error);

      if (field === "email") {
        return {
          success: false,
          fieldErrors: {
            email: "An account with this email already exists.",
          },
        };
      }
      if (field === "phone") {
        return {
          success: false,
          fieldErrors: {
            phone: "An account with this phone already exists.",
          },
        };
      }
      return {
        success: false,
        formError: "An account with those details already exists.",
      };
    }

    return {
      success: false,
      formError: "Unable to register. Please try again.",
    };
  }
}
