import "server-only";

import {
  parseMmkAmount,
  validatePaymentAmount,
} from "../../fund-management/lib/fund-financials";

const MIN_VOID_REASON_LENGTH = 5;
const MAX_VOID_REASON_LENGTH = 500;

export type CashPaymentField = "houseId" | "payerUserId" | "amount";

export interface NormalizedCashPaymentInput {
  houseId: string;
  payerUserId: string;
  amount: number;
}

export type CashPaymentValidationResult =
  | { ok: true; data: NormalizedCashPaymentInput }
  | {
      ok: false;
      fieldErrors: Partial<Record<CashPaymentField, string>>;
      formError?: string;
    };

function getFormDataString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value === "string") {
    return value;
  }
  return "";
}

export function validateCashPaymentInput(
  formData: FormData,
  assessmentAmount: number,
): CashPaymentValidationResult {
  const fieldErrors: Partial<Record<CashPaymentField, string>> = {};

  const houseId = getFormDataString(formData, "houseId");
  const payerUserId = getFormDataString(formData, "payerUserId");
  const rawAmount = getFormDataString(formData, "amount").trim();

  if (!houseId) {
    fieldErrors.houseId = "Select a house.";
  }
  if (!payerUserId) {
    fieldErrors.payerUserId = "Select a payer.";
  }

  let amount = 0;
  const parsedAmount = parseMmkAmount(rawAmount);
  if (!parsedAmount.ok) {
    fieldErrors.amount = parsedAmount.error;
  } else {
    const payment = validatePaymentAmount({
      paymentAmount: parsedAmount.data,
      assessmentAmount,
    });
    if (!payment.ok) fieldErrors.amount = payment.error;
    else amount = payment.data;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return { ok: true, data: { houseId, payerUserId, amount } };
}

export type VoidReasonValidationResult =
  | { ok: true; data: string }
  | { ok: false; error: string };

export function validateVoidReason(
  rawReason: string,
): VoidReasonValidationResult {
  const reason = rawReason.trim();
  if (!reason || reason.length < MIN_VOID_REASON_LENGTH) {
    return {
      ok: false,
      error: `Void reason is required (minimum ${MIN_VOID_REASON_LENGTH} characters).`,
    };
  }
  if (reason.length > MAX_VOID_REASON_LENGTH) {
    return {
      ok: false,
      error: `Void reason must be at most ${MAX_VOID_REASON_LENGTH} characters.`,
    };
  }
  return { ok: true, data: reason };
}
