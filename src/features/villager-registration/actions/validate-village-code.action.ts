"use server";

import { VillageStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getClientIp } from "@/lib/auth/client-ip";
import { reserveSignupAttempt } from "@/lib/auth/login-throttle";
import {
  validateVillageCodeInput,
  type VillageCodeField,
} from "../lib/registration-validators";

export type ValidateVillageCodeActionResult =
  | {
      success: true;
      redirectTo: string;
    }
  | {
      success: false;
      formError?: string;
      fieldErrors?: Partial<Record<VillageCodeField, string>>;
    };

export async function validateVillageCodeAction(
  formData: FormData,
): Promise<ValidateVillageCodeActionResult> {
  // Village codes are short, so guessing them is throttled per IP.
  const throttle = await reserveSignupAttempt(prisma, {
    clientIp: await getClientIp(),
  });
  if (throttle.blocked) {
    return {
      success: false,
      formError: "Too many attempts. Please try again later.",
    };
  }

  const validation = validateVillageCodeInput(formData);

  if (!validation.ok) {
    return {
      success: false,
      fieldErrors: validation.fieldErrors,
      formError: validation.formError,
    };
  }

  const { villageCode } = validation.data;

  const village = await prisma.village.findUnique({
    where: {
      villageCode,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (!village || village.status !== VillageStatus.ACTIVE) {
    return {
      success: false,
      formError: "Invalid village code.",
    };
  }

  return {
    success: true,
    redirectTo: `/signup/register?code=${encodeURIComponent(villageCode)}`,
  };
}
