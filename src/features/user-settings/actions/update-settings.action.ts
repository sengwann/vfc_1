"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAuthenticatedUser } from "@/lib/auth/guards";
import {
  validateSettingsInput,
  type SettingsField,
} from "../lib/settings-validators";

export type UpdateSettingsActionResult =
  | { success: true }
  | {
      success: false;
      formError?: string;
      fieldErrors?: Partial<Record<SettingsField, string>>;
    };

export async function updateSettingsAction(
  formData: FormData,
): Promise<UpdateSettingsActionResult> {
  const user = await requireAuthenticatedUser();

  const validation = validateSettingsInput(formData);
  if (!validation.ok) {
    return {
      success: false,
      fieldErrors: validation.fieldErrors,
      formError: validation.formError,
    };
  }

  const { language } = validation.data;

  try {
    await prisma.userSettings.upsert({
      where: { userId: user.id },
      update: { language },
      create: { userId: user.id, language },
    });
  } catch {
    return {
      success: false,
      formError: "Unable to update settings. Please try again.",
    };
  }

  revalidatePath("/settings");

  return { success: true };
}
