"use server";
import { requireChief } from "@/lib/authz";
import { submittedFund } from "../lib/fund-write";
import { fundActionFailure } from "../lib/fund-action-error";
import { extendFund } from "../lib/fund-completion";
import { validateFundExtension } from "../lib/fund-extension-validators";

export async function extendFundAction(form: FormData) {
  const { villageId } = await requireChief();
  try {
    await extendFund(villageId, submittedFund(form), validateFundExtension(form));
    return { success: true as const };
  } catch (error) { return fundActionFailure(error); }
}
