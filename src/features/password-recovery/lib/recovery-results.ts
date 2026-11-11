/*
 * What the recovery actions hand back to their forms, and the mapping from
 * service outcomes to those answers. Types and pure functions only (no imports
 * at runtime), so tests can run them directly. The forms translate the codes;
 * the codes are the contract.
 *
 * "use server" files may only export async functions, which is why these live
 * here and not next to the actions.
 */

import type {
  IssueRecoveryResult,
  RedeemRecoveryResult,
} from "./password-recovery-service";
import type { RejectOutcome, WithdrawOutcome } from "./recovery-transitions";

/* ---- public: request ---- */

export type RequestFormState =
  | { status: "idle" }
  /** The same answer whether or not the account exists. */
  | { status: "submitted" }
  | { status: "invalid" };

/* ---- public: redeem ---- */

export type RedeemErrorCode =
  | "invalid_input"
  | "password_mismatch"
  | "password_length"
  | "password_bytes"
  | "invalid_code"
  | "throttled"
  | "busy";

export type RedeemFormState =
  | { status: "idle" }
  | { status: "error"; error: RedeemErrorCode };

export function redeemErrorFor(
  result: Exclude<RedeemRecoveryResult, { kind: "completed" }>,
): RedeemErrorCode {
  switch (result.kind) {
    case "weak_password":
      return result.reason === "LENGTH" ? "password_length" : "password_bytes";
    case "throttled":
      return "throttled";
    case "invalid":
      return "invalid_code";
  }
}

/* ---- approver: issue ---- */

export type IssueErrorCode =
  | "invalid_request"
  | "password_required"
  | "bad_password"
  | "throttled"
  | "not_found"
  | "expired"
  | "wrong_state"
  | "not_eligible"
  | "self_action"
  | "rate_limited"
  | "busy";

export type IssueFormState =
  | { status: "idle" }
  | {
      status: "issued";
      /** Grouped for reading aloud, e.g. "K7M2-9XQ4-D8TA-W3PZ". Shown once. */
      code: string;
      codeExpiresAt: string;
      reissued: boolean;
      requestId: string;
    }
  | { status: "error"; error: IssueErrorCode };

export function issueErrorFor(
  result: Exclude<IssueRecoveryResult, { kind: "issued" }>,
): IssueErrorCode {
  switch (result.kind) {
    case "bad_password":
      return "bad_password";
    case "throttled":
      return "throttled";
    case "not_found":
      return "not_found";
    case "blocked":
      switch (result.reason) {
        case "EXPIRED":
          return "expired";
        case "RATE_LIMITED":
          return "rate_limited";
        case "SELF_ACTION":
          return "self_action";
        case "NOT_ELIGIBLE":
        case "VILLAGE_NOT_ACTIVE":
          return "not_eligible";
        default:
          return "wrong_state";
      }
  }
}

/* ---- approver: reject / withdraw (redirect with ?error= or ?notice=) ---- */

export const RECOVERY_NOTICE = {
  REJECTED: "rejected",
  WITHDRAWN: "withdrawn",
} as const;

export type RecoveryRedirectCode =
  | (typeof RECOVERY_NOTICE)[keyof typeof RECOVERY_NOTICE]
  | "invalid_request"
  | "note_required"
  | "note_too_long"
  | "note_invalid"
  | "not_found"
  | "expired"
  | "wrong_state"
  | "busy";

type DecisionOutcome = RejectOutcome | WithdrawOutcome;

export function decisionRedirect(
  outcome: DecisionOutcome,
): { kind: "notice" | "error"; code: RecoveryRedirectCode } {
  switch (outcome.kind) {
    case "rejected":
      return { kind: "notice", code: RECOVERY_NOTICE.REJECTED };
    case "withdrawn":
      return { kind: "notice", code: RECOVERY_NOTICE.WITHDRAWN };
    case "not_found":
      return { kind: "error", code: "not_found" };
    case "invalid_note":
      return {
        kind: "error",
        code:
          outcome.reason === "REQUIRED"
            ? "note_required"
            : outcome.reason === "TOO_LONG"
              ? "note_too_long"
              : "note_invalid",
      };
    case "blocked":
      return {
        kind: "error",
        code: outcome.reason === "EXPIRED" ? "expired" : "wrong_state",
      };
  }
}
