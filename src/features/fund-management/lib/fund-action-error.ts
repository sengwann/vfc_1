import "server-only";
import { redirect } from "next/navigation";
import { TransactionAuthorityError } from "@/lib/authz/transaction-authority";
import { FinancialLockNotFoundError } from "@/lib/db/financial-locks";
import { VILLAGE_READ_ONLY_MESSAGE } from "@/features/village-deactivation/lib/village-deactivation-rules";
import { FundWriteError } from "./fund-write";

/** Outside retry callbacks. Unexpected/audit/navigation failures propagate. */
export function fundActionFailure(error: unknown): { success: false; formError: string; code?: "VILLAGE_READ_ONLY" } {
  if (error instanceof TransactionAuthorityError) {
    if (error.code === "VFC_AUTH_SESSION") redirect("/login");
    if (error.code === "VFC_AUTH_PASSWORD_CHANGE") redirect("/change-password");
    if (error.code === "VILLAGE_READ_ONLY") return { success: false, code: "VILLAGE_READ_ONLY", formError: VILLAGE_READ_ONLY_MESSAGE };
    redirect("/forbidden");
  }
  if (error instanceof FinancialLockNotFoundError) return { success: false, formError: "Fund not found." };
  if (error instanceof FundWriteError) return { success: false, formError: error.message };
  throw error;
}
