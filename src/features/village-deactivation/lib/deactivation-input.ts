/*
 * Pure parsing of the deactivation workflow form fields. Only the shape of the
 * input is checked here. Who the user is, which village they belong to, and
 * what state the request is in are decided server-side against the database.
 *
 * The Chief's village is never read from the form: it comes from the session,
 * so a Chief cannot submit for another village by editing a hidden field.
 */

import {
  REASON_MAX_LENGTH,
  parseVillageId,
} from "../../village-management/lib/lifecycle-input";

export const DEACTIVATION_REASON_MAX_LENGTH = REASON_MAX_LENGTH;

export const DEACTIVATION_REQUEST_ID_MAX_LENGTH = 64;

export type DeactivationInputError =
  | "INVALID_REQUEST_ID"
  | "REASON_REQUIRED"
  | "REASON_TOO_LONG"
  | "CONFIRMATION_REQUIRED";

export type ReasonResult =
  | { ok: true; reason: string }
  | { ok: false; error: "REASON_REQUIRED" | "REASON_TOO_LONG" };

/** A mandatory reason: trimmed, not empty, at most 200 characters. */
export function parseRequiredReason(value: unknown): ReasonResult {
  if (typeof value !== "string") {
    return { ok: false, error: "REASON_REQUIRED" };
  }

  const reason = value.trim();

  if (reason.length === 0) {
    return { ok: false, error: "REASON_REQUIRED" };
  }

  // Count code points so an emoji is one character, not two.
  if (Array.from(reason).length > DEACTIVATION_REASON_MAX_LENGTH) {
    return { ok: false, error: "REASON_TOO_LONG" };
  }

  return { ok: true, reason };
}

/** Request ids are cuid() values, so only a sanity bound is applied. */
export function parseRequestId(value: unknown): string | null {
  // Same bound and trimming as village ids.
  return parseVillageId(value);
}

/**
 * Explicit confirmation for cancellation. A checkbox posts "on" by default; the
 * dedicated confirm field posts "true". Anything else, including a missing
 * field, is not a confirmation.
 */
export function parseConfirmation(value: unknown): boolean {
  return value === "on" || value === "true";
}

export type SubmitRequestInput =
  | { ok: true; reason: string }
  | { ok: false; error: "REASON_REQUIRED" | "REASON_TOO_LONG" };

export function parseSubmitRequestInput(formData: FormData): SubmitRequestInput {
  return parseRequiredReason(formData.get("reason"));
}

export type ApproveInput =
  | { ok: true; requestId: string }
  | { ok: false; error: "INVALID_REQUEST_ID" };

export function parseApproveInput(formData: FormData): ApproveInput {
  const requestId = parseRequestId(formData.get("requestId"));

  if (!requestId) {
    return { ok: false, error: "INVALID_REQUEST_ID" };
  }

  return { ok: true, requestId };
}

export type DecisionWithReasonInput =
  | { ok: true; requestId: string; reason: string }
  | { ok: false; error: DeactivationInputError };

/** Reject: the System Admin must give a reason. */
export function parseRejectInput(formData: FormData): DecisionWithReasonInput {
  const requestId = parseRequestId(formData.get("requestId"));

  if (!requestId) {
    return { ok: false, error: "INVALID_REQUEST_ID" };
  }

  const reason = parseRequiredReason(formData.get("reason"));

  if (!reason.ok) {
    return { ok: false, error: reason.error };
  }

  return { ok: true, requestId, reason: reason.reason };
}

/** Cancel: the Chief must give a reason and explicitly confirm. */
export function parseCancelInput(formData: FormData): DecisionWithReasonInput {
  const requestId = parseRequestId(formData.get("requestId"));

  if (!requestId) {
    return { ok: false, error: "INVALID_REQUEST_ID" };
  }

  const reason = parseRequiredReason(formData.get("reason"));

  if (!reason.ok) {
    return { ok: false, error: reason.error };
  }

  if (!parseConfirmation(formData.get("confirm"))) {
    return { ok: false, error: "CONFIRMATION_REQUIRED" };
  }

  return { ok: true, requestId, reason: reason.reason };
}
