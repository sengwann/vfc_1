/*
 * Maps the outcome of a workflow transition to what the action answers with:
 * a redirect to the right page carrying a machine-readable code in the query
 * string, the same convention as run-lifecycle-action.ts (?error=...). Pure
 * and import-free at runtime, so it can be unit tested directly; the outcome
 * types are only imported as types.
 *
 * The pages that read these codes arrive in Phase 8. The codes are the
 * contract; the text is translated by the page.
 */

import type {
  ApproveOutcome,
  CancelOutcome,
  RejectOutcome,
  SubmitOutcome,
} from "./deactivation-transitions";
import type { DeactivationInputError } from "./deactivation-input";

/** Where each actor lands. The pages themselves are built in Phase 8. */
export const CHIEF_DEACTIVATION_PATH = "/village/deactivation";
export const ADMIN_DEACTIVATION_PATH = "/admin/deactivation-requests";

export const DEACTIVATION_ERROR_PARAM = "error";
export const DEACTIVATION_NOTICE_PARAM = "notice";
export const DEACTIVATION_UNTIL_PARAM = "until";

export const DEACTIVATION_NOTICE = {
  SUBMITTED: "submitted",
  APPROVED: "approved",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
} as const;

export const DEACTIVATION_ERROR = {
  ACTIVE_FUND_EXISTS: "active_fund_exists",
  INVALID_REQUEST: "invalid_request",
  REASON_REQUIRED: "reason_required",
  REASON_TOO_LONG: "reason_too_long",
  CONFIRMATION_REQUIRED: "confirmation_required",
  VILLAGE_NOT_ACTIVE: "village_not_active",
  UNRESOLVED_REQUEST_EXISTS: "unresolved_request_exists",
  COOLDOWN_ACTIVE: "cooldown_active",
  NOT_PENDING: "not_pending",
  NOT_APPROVED: "not_approved",
  DEADLINE_REACHED: "deadline_reached",
  /** A serialization conflict that survived every retry. */
  BUSY: "busy",
} as const;

export type DeactivationErrorCode =
  (typeof DEACTIVATION_ERROR)[keyof typeof DEACTIVATION_ERROR];

export type DeactivationNoticeCode =
  (typeof DEACTIVATION_NOTICE)[keyof typeof DEACTIVATION_NOTICE];

export type DeactivationActionResult =
  | { type: "success"; notice: DeactivationNoticeCode }
  | { type: "error"; error: DeactivationErrorCode; until?: Date }
  | { type: "forbidden" }
  | { type: "not_found" };

export function inputErrorResult(
  error: DeactivationInputError,
): DeactivationActionResult {
  switch (error) {
    case "REASON_REQUIRED":
      return { type: "error", error: DEACTIVATION_ERROR.REASON_REQUIRED };
    case "REASON_TOO_LONG":
      return { type: "error", error: DEACTIVATION_ERROR.REASON_TOO_LONG };
    case "CONFIRMATION_REQUIRED":
      return { type: "error", error: DEACTIVATION_ERROR.CONFIRMATION_REQUIRED };
    default:
      return { type: "error", error: DEACTIVATION_ERROR.INVALID_REQUEST };
  }
}

export function submitResult(outcome: SubmitOutcome): DeactivationActionResult {
  switch (outcome.kind) {
    case "created":
      return { type: "success", notice: DEACTIVATION_NOTICE.SUBMITTED };
    case "invalid_reason":
      return inputErrorResult(outcome.error);
    case "forbidden":
      return { type: "forbidden" };
    case "blocked":
      switch (outcome.reason) {
        case "COOLDOWN_ACTIVE":
          return {
            type: "error",
            error: DEACTIVATION_ERROR.COOLDOWN_ACTIVE,
            until: outcome.cooldownEndsAt,
          };
        case "UNRESOLVED_REQUEST_EXISTS":
          return {
            type: "error",
            error: DEACTIVATION_ERROR.UNRESOLVED_REQUEST_EXISTS,
          };
        default:
          return { type: "error", error: DEACTIVATION_ERROR.VILLAGE_NOT_ACTIVE };
      }
  }
}

export function approveResult(outcome: ApproveOutcome): DeactivationActionResult {
  switch (outcome.kind) {
    case "approved":
      return { type: "success", notice: DEACTIVATION_NOTICE.APPROVED };
    case "not_found":
      return { type: "not_found" };
    case "forbidden":
      return { type: "forbidden" };
    case "blocked":
      return {
        type: "error",
        error:
          outcome.reason === "ACTIVE_FUND_EXISTS"
            ? DEACTIVATION_ERROR.ACTIVE_FUND_EXISTS
            : outcome.reason === "VILLAGE_NOT_ACTIVE"
            ? DEACTIVATION_ERROR.VILLAGE_NOT_ACTIVE
            : DEACTIVATION_ERROR.NOT_PENDING,
      };
  }
}

export function rejectResult(outcome: RejectOutcome): DeactivationActionResult {
  switch (outcome.kind) {
    case "rejected":
      return { type: "success", notice: DEACTIVATION_NOTICE.REJECTED };
    case "invalid_reason":
      return inputErrorResult(outcome.error);
    case "not_found":
      return { type: "not_found" };
    case "forbidden":
      return { type: "forbidden" };
    case "blocked":
      return { type: "error", error: DEACTIVATION_ERROR.NOT_PENDING };
  }
}

export function cancelResult(outcome: CancelOutcome): DeactivationActionResult {
  switch (outcome.kind) {
    case "cancelled":
      return { type: "success", notice: DEACTIVATION_NOTICE.CANCELLED };
    case "invalid_reason":
      return inputErrorResult(outcome.error);
    case "not_found":
      return { type: "not_found" };
    case "forbidden":
      return { type: "forbidden" };
    case "blocked":
      return {
        type: "error",
        error:
          outcome.reason === "DEADLINE_REACHED"
            ? DEACTIVATION_ERROR.DEADLINE_REACHED
            : DEACTIVATION_ERROR.NOT_APPROVED,
      };
  }
}

/** The redirect target for a result. `forbidden` has no path: callers use redirectForbidden(). */
export function resultPath(
  basePath: string,
  result: Exclude<DeactivationActionResult, { type: "forbidden" }>,
): string {
  if (result.type === "not_found") {
    return basePath;
  }

  const params = new URLSearchParams();

  if (result.type === "success") {
    params.set(DEACTIVATION_NOTICE_PARAM, result.notice);
  } else {
    params.set(DEACTIVATION_ERROR_PARAM, result.error);

    if (result.until) {
      params.set(DEACTIVATION_UNTIL_PARAM, result.until.toISOString());
    }
  }

  return `${basePath}?${params.toString()}`;
}
