"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/db/transaction";
import { acquireVillageScopes } from "@/lib/db/village-scope";
import { authorizeFinancialTransaction, TransactionAuthorityError } from "@/lib/authz/transaction-authority";
import { requireActiveCollector } from "@/lib/authz";
import { redirectForbidden } from "@/lib/authz/authz.errors";
import { LOGIN_ROUTE, CHANGE_PASSWORD_ROUTE } from "@/lib/auth/auth.constants";
import { createFinancialAudit } from "@/lib/audit/financial-audit";
import { validateVoidReason } from "../lib/cash-payment-validators";
import { VILLAGE_READ_ONLY_MESSAGE, type VillageReadOnlyCode } from "../../village-deactivation/lib/village-deactivation-rules";

export type VoidPaymentActionResult =
  | { success: true }
  | { success: false; error?: string; code?: VillageReadOnlyCode; fieldErrors?: Record<string, string> };

export async function voidPaymentAction(formData: FormData): Promise<VoidPaymentActionResult> {
  const { villageId } = await requireActiveCollector();
  const paymentId = formData.get("paymentId");
  if (typeof paymentId !== "string" || !paymentId.trim() || paymentId.includes("\0")) return { success: false, error: "Payment not found." };
  const reason = formData.get("voidReason");
  const validation = validateVoidReason(typeof reason === "string" ? reason : "");
  if (!validation.ok) return { success: false, fieldErrors: { voidReason: validation.error } };
  try {
    return await withSerializableRetry(() => prisma.$transaction(async (tx): Promise<VoidPaymentActionResult> => {
      await acquireVillageScopes(tx, [villageId]);
      // Identity discovery only; no row locks or authority decisions yet.
      const identity = await tx.payment.findFirst({ where: { id: paymentId, villageId }, select: { fundId: true, houseId: true } });
      const authority = await authorizeFinancialTransaction(tx, { villageId, permission: "collector", fundIds: identity ? [identity.fundId] : [], houseIds: identity ? [identity.houseId] : [] });
      if (!identity) return { success: false, error: "Payment not found." };
      await tx.$queryRaw`SELECT id FROM public."Payment" WHERE id=${paymentId} AND "villageId"=${villageId} ORDER BY id FOR UPDATE`;
      const payment = await tx.payment.findFirst({ where: { id: paymentId, villageId, fundId: identity.fundId, houseId: identity.houseId } });
      if (!payment || payment.status !== "ACCEPTED") return { success: false, error: "Only accepted payments can be voided." };
      const fund = authority.funds[0];
      // v1.0 permits void while ACTIVE, including after collection expiry.
      if (fund.status !== "ACTIVE") return { success: false, error: "This fund is no longer active." };
      const assessment = await tx.fundHouseAssessment.findFirst({ where: { id: payment.fundHouseAssessmentId, fundId: payment.fundId, houseId: payment.houseId, villageId } });
      if (!assessment) return { success: false, error: "Payment assessment is not available." };
      await tx.$queryRaw`SELECT id FROM public."Receipt" WHERE "paymentId"=${paymentId} AND "villageId"=${villageId} ORDER BY id FOR UPDATE`;
      const receipt = await tx.receipt.findFirst({ where: { paymentId, villageId, status: "ACTIVE" } });
      if (!receipt) return { success: false, error: "Active receipt is not available." };
      await tx.payment.update({ where: { id: payment.id }, data: { status: "VOIDED", voidReason: validation.data } });
      await tx.receipt.update({ where: { id: receipt.id }, data: { status: "VOIDED" } });
      const common = { villageId, fundId: payment.fundId, actorUserId: authority.actor.id };
      await createFinancialAudit(tx, { ...common, event: "PAYMENT_VOIDED", metadata: { paymentId, houseId: payment.houseId, assessmentId: assessment.id, amount: payment.amount, reason: validation.data } });
      await createFinancialAudit(tx, { ...common, event: "RECEIPT_VOIDED", metadata: { paymentId, receiptId: receipt.id, reason: validation.data } });
      return { success: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
  } catch (error) {
    if (error instanceof TransactionAuthorityError) {
      if (error.code === "VFC_AUTH_SESSION") return redirect(LOGIN_ROUTE);
      if (error.code === "VFC_AUTH_PASSWORD_CHANGE") return redirect(CHANGE_PASSWORD_ROUTE);
      if (error.code === "VILLAGE_READ_ONLY") return { success: false, code: "VILLAGE_READ_ONLY", error: VILLAGE_READ_ONLY_MESSAGE };
      return redirectForbidden();
    }
    throw error;
  }
}
