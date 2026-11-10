"use server";
import { requireChief } from "@/lib/authz";
import { validateCreateFundInput, type CreateFundField } from "../lib/fund-validators";
import { createFundDraft } from "../lib/fund-write";
import { fundActionFailure } from "../lib/fund-action-error";
import type { VillageReadOnlyCode } from "../../village-deactivation/lib/village-deactivation-rules";

export type CreateFundActionResult =
  | { success: true; fundId: string }
  | {
      success: false;
      formError?: string;
      /** Set when the village is read-only (approved deactivation). */
      code?: VillageReadOnlyCode;
      fieldErrors?: Partial<Record<CreateFundField, string>>;
    };

export async function createFundAction(formData: FormData): Promise<CreateFundActionResult> {
  const { villageId } = await requireChief();
  const validation = validateCreateFundInput(formData);
  if (!validation.ok) return { success: false, fieldErrors: validation.fieldErrors, formError: validation.formError };
  const { totalAmount, ...terms } = validation.data;
  try {
    // The existing form field is a village-wide target; never an assessment.
    const fund = await createFundDraft(villageId, { ...terms, villageTargetAmount: totalAmount });
    return { success: true, fundId: fund.id };
  } catch (error) { return fundActionFailure(error); }
}
