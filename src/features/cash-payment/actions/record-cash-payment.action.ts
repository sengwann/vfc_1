"use server";

import { MembershipStatus, Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/db/transaction";
import { authorizeFinancialTransaction, TransactionAuthorityError } from "@/lib/authz/transaction-authority";
import { requireActiveCollector } from "@/lib/authz";
import { redirectForbidden } from "@/lib/authz/authz.errors";
import { LOGIN_ROUTE, CHANGE_PASSWORD_ROUTE } from "@/lib/auth/auth.constants";
import { createFinancialAudit } from "@/lib/audit/financial-audit";
import { generateReceiptNumber } from "@/lib/receipts/receipt-number";
import { FinancialLockNotFoundError } from "@/lib/db/financial-locks";
import { validateCashPaymentInput, type CashPaymentField } from "../lib/cash-payment-validators";
import { VILLAGE_READ_ONLY_MESSAGE, type VillageReadOnlyCode } from "../../village-deactivation/lib/village-deactivation-rules";

export type RecordCashPaymentActionResult =
  | { success: true }
  | { success: false; formError?: string; code?: VillageReadOnlyCode; fieldErrors?: Partial<Record<CashPaymentField, string>> };

export async function recordCashPaymentAction(formData: FormData): Promise<RecordCashPaymentActionResult> {
  // Routing context only. The transaction repeats every authoritative check.
  const { villageId } = await requireActiveCollector();
  const fundId = formData.get("fundId");
  const version = formData.get("termsVersion");
  const houseId = formData.get("houseId");
  if (typeof fundId !== "string" || !fundId.trim() || fundId.includes("\0") ||
      typeof version !== "string" || !/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version))) {
    return { success: false, formError: "Fund details have changed. Reload the payment form." };
  }
  if (typeof houseId !== "string" || !houseId.trim() || houseId.includes("\0")) {
    return { success: false, fieldErrors: { houseId: "Selected house is not available." } };
  }
  try {
    return await withSerializableRetry(() => prisma.$transaction(async (tx): Promise<RecordCashPaymentActionResult> => {
      const authority = await authorizeFinancialTransaction(tx, { villageId, permission: "collector", fundIds: [fundId], houseIds: [houseId] });
      const fund = await tx.fund.findFirst({ where: { id: fundId, villageId } });
      if (!fund || fund.status !== "ACTIVE") return { success: false, formError: "This fund is no longer active." };
      if (fund.termsVersion !== Number(version)) return { success: false, formError: "Fund details have changed. Reload the payment form." };
      // PostgreSQL DATE and the canonical Phase 2 window predicate avoid server
      // timezone assumptions. End date includes the entire Asia/Yangon day.
      const [window] = await tx.$queryRaw<{ open: boolean }[]>`
        SELECT public.vfc_payment_window("startDate","endDate",clock_timestamp()) AS open
        FROM public."Fund" WHERE id=${fundId} AND "villageId"=${villageId}`;
      if (!window?.open) return { success: false, formError: "This fund is not open for payment today." };
      const house = authority.houses[0];
      if (!house?.isActive) return { success: false, fieldErrors: { houseId: "Selected house is not available." } };
      // Frozen rows cannot change after activation. Never recalculate from live Houses.
      const assessment = await tx.fundHouseAssessment.findFirst({ where: { fundId, houseId, villageId } });
      if (!assessment) return { success: false, formError: "This house has no assessment for the selected fund." };
      const validation = validateCashPaymentInput(formData, assessment.assessmentAmount);
      if (!validation.ok) return { success: false, fieldErrors: validation.fieldErrors, formError: validation.formError };
      const { payerUserId, amount } = validation.data;
      // Scope serializes membership changes; actor is already row-locked by the
      // authority helper. This is a read, not a later out-of-order User lock.
      const payer = await tx.user.findFirst({ where: { id: payerUserId, houseId, villageId, membershipStatus: MembershipStatus.ACTIVE }, select: { id: true } });
      if (!payer) return { success: false, fieldErrors: { payerUserId: "Selected payer is not an active member of the selected house." } };
      await tx.$queryRaw`SELECT id FROM public."Payment" WHERE "fundId"=${fundId} AND "houseId"=${houseId} AND "villageId"=${villageId} ORDER BY id FOR UPDATE`;
      const accepted = await tx.payment.findFirst({ where: { fundId, houseId, villageId, status: "ACCEPTED" }, select: { id: true } });
      if (accepted) return { success: false, formError: "A valid payment already exists for this fund and house." };
      const previous = await tx.payment.findFirst({ where: { fundId, houseId, villageId, fundHouseAssessmentId: assessment.id, status: "VOIDED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      const receiptNumber = await generateReceiptNumber(tx); // Existing global allocator unchanged.
      const payment = await tx.payment.create({ data: { villageId, fundId, houseId, fundHouseAssessmentId: assessment.id, payerUserId, collectorUserId: authority.actor.id, amount, status: "ACCEPTED" } });
      const receipt = await tx.receipt.create({ data: { receiptNumber, paymentId: payment.id, villageId, status: "ACTIVE" } });
      const common = { villageId, fundId, actorUserId: authority.actor.id };
      const metadata = { paymentId: payment.id, houseId, assessmentId: assessment.id, amount };
      await createFinancialAudit(tx, { ...common, event: "PAYMENT_CREATED", metadata });
      await createFinancialAudit(tx, { ...common, event: "RECEIPT_CREATED", metadata: { paymentId: payment.id, receiptId: receipt.id, receiptNumber } });
      if (previous) await createFinancialAudit(tx, { ...common, event: "PAYMENT_REPLACED", metadata: { ...metadata, previousPaymentId: previous.id, reason: previous.voidReason! } });
      return { success: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) {
    if (error instanceof TransactionAuthorityError) {
      if (error.code === "VFC_AUTH_SESSION") return redirect(LOGIN_ROUTE);
      if (error.code === "VFC_AUTH_PASSWORD_CHANGE") return redirect(CHANGE_PASSWORD_ROUTE);
      if (error.code === "VILLAGE_READ_ONLY") return { success: false, code: "VILLAGE_READ_ONLY", formError: VILLAGE_READ_ONLY_MESSAGE };
      return redirectForbidden();
    }
    if (error instanceof FinancialLockNotFoundError) return { success: false, formError: "Selected fund or house is not available." };
    // Keep audit, integrity, exhausted retry and navigation failures observable.
    throw error;
  }
}
