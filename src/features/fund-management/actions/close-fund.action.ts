"use server";
import { redirect } from "next/navigation";
import { requireChief } from "@/lib/authz";
import { submittedFund } from "../lib/fund-write";
import { closeFund } from "../lib/fund-completion";
import { fundActionFailure } from "../lib/fund-action-error";

export async function closeFundAction(form: FormData): Promise<void> {
  const { villageId } = await requireChief();
  const id = form.get("fundId");
  if (typeof id !== "string" || !id.trim() || id.includes("\0")) redirect("/village/funds");
  let failure: string | undefined;
  try { await closeFund(villageId, submittedFund(form)); }
  catch (error) { failure = fundActionFailure(error).formError; }
  const path = `/village/funds/${encodeURIComponent(id)}`;
  redirect(failure ? `${path}?lifecycleError=${encodeURIComponent(failure)}` : path);
}
