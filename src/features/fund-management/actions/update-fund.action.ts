"use server";
import { requireChief } from "@/lib/authz";
import { validateFundInput, type FundField } from "../lib/fund-validators";
import { updateFundDraft, submittedFund } from "../lib/fund-write";
import { fundActionFailure } from "../lib/fund-action-error";
import type { VillageReadOnlyCode } from "../../village-deactivation/lib/village-deactivation-rules";

export type UpdateFundActionResult =
  | {
      success: true;
    }
  | {
      success: false;
      formError?: string;
      /** Set when the village is read-only (approved deactivation). */
      code?: VillageReadOnlyCode;
      fieldErrors?: Partial<Record<FundField, string>>;
    };

export async function updateFundAction(formData: FormData): Promise<UpdateFundActionResult> {
  const { villageId } = await requireChief();
  const validation = validateFundInput(formData);
  if (!validation.ok) return { success: false, fieldErrors: validation.fieldErrors, formError: validation.formError };
  const { targetAmount, ...terms } = validation.data;
  try {
    await updateFundDraft(villageId, submittedFund(formData), { ...terms, villageTargetAmount: targetAmount });
    return { success: true };
  } catch (error) { return fundActionFailure(error); }
}
