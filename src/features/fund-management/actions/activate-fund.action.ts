"use server";
import { redirect } from "next/navigation";
import { requireChief } from "@/lib/authz";
import { activateFund, submittedFund } from "../lib/fund-write";
import { fundActionFailure } from "../lib/fund-action-error";

export async function activateFundAction(formData: FormData): Promise<void> {
  const { villageId } = await requireChief();
  // External effects occur only after the outer transaction resolves/rejects.
  let failure: string | undefined;
  const id = formData.get("fundId");
  if (typeof id !== "string" || !id.trim() || id.includes("\0")) redirect("/village/funds");
  try { await activateFund(villageId, submittedFund(formData)); }
  catch (error) { failure = fundActionFailure(error).formError; }
  const path = `/village/funds/${encodeURIComponent(id)}`;
  redirect(failure ? `${path}?activationError=${encodeURIComponent(failure)}` : path);
}
