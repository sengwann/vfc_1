/*
 * Pure password recovery rules. The only import is the constants file, which
 * has none itself, so this can be unit tested directly (same approach as
 * village-deactivation-rules.ts). Every function takes the current time as an
 * argument; nothing here reads a clock, the database or the environment.
 *
 * Request states (PasswordRecoveryStatus) and the actions that move between
 * them:
 *
 *   issue          PENDING      -> CODE_ISSUED
 *                  CODE_ISSUED  -> CODE_ISSUED   (re-issue: the old code dies)
 *   reject         PENDING      -> REJECTED
 *   withdraw       CODE_ISSUED  -> REVOKED       (by an authority, with a note)
 *   redeem         CODE_ISSUED  -> COMPLETED     (the member sets a password)
 *   expire         PENDING      -> EXPIRED       (request not decided in time)
 *                  CODE_ISSUED  -> EXPIRED       (code not used in time)
 *   revokeBySystem PENDING      -> REVOKED       (target no longer eligible)
 *                  CODE_ISSUED  -> REVOKED       (too many wrong codes, or the
 *                                                target is no longer eligible)
 *
 * COMPLETED, REJECTED, EXPIRED and REVOKED are final.
 *
 * The database cannot check transitions (a CHECK cannot see the previous row).
 * The service therefore also writes every transition as
 * UPDATE ... WHERE id = ? AND status = <expected>, so two racing requests
 * cannot both win.
 *
 * Expiry is checked lazily: an expiry instant is "due" when now >= instant.
 * The same boundary is used everywhere, so at one instant a code is either
 * usable or expired, never both.
 */

import {
  RECOVERY_MAX_FAILED_REDEEM_ATTEMPTS,
  RECOVERY_NOTE_MAX_LENGTH,
  RECOVERY_REQUEST_TTL_MS,
  RECOVERY_CODE_TTL_MS,
} from "./recovery-config";

export type RecoveryStatus =
  | "PENDING"
  | "CODE_ISSUED"
  | "COMPLETED"
  | "REJECTED"
  | "EXPIRED"
  | "REVOKED";

export type RecoveryAction =
  | "issue"
  | "reject"
  | "withdraw"
  | "redeem"
  | "expire"
  | "revokeBySystem";

export type RecoveryRole = "SYSTEM_ADMIN" | "CHIEF" | "VILLAGER";
export type RecoveryMembershipStatus =
  | "PENDING"
  | "ACTIVE"
  | "REJECTED"
  | "REMOVED";
export type RecoveryVillageStatus = "ACTIVE" | "SUSPENDED" | "DEACTIVATED";

/** Requests that can still be acted on: at most one per user. */
export const ACTIVE_STATUSES: readonly RecoveryStatus[] = [
  "PENDING",
  "CODE_ISSUED",
];

export const RECOVERY_ALLOWED_FROM: Record<
  RecoveryAction,
  readonly RecoveryStatus[]
> = {
  issue: ["PENDING", "CODE_ISSUED"],
  reject: ["PENDING"],
  withdraw: ["CODE_ISSUED"],
  redeem: ["CODE_ISSUED"],
  expire: ["PENDING", "CODE_ISSUED"],
  revokeBySystem: ["PENDING", "CODE_ISSUED"],
};

export const RECOVERY_TARGET_STATUS: Record<RecoveryAction, RecoveryStatus> = {
  issue: "CODE_ISSUED",
  reject: "REJECTED",
  withdraw: "REVOKED",
  redeem: "COMPLETED",
  expire: "EXPIRED",
  revokeBySystem: "REVOKED",
};

export function canTransitionRecovery(
  action: RecoveryAction,
  status: RecoveryStatus,
): boolean {
  return RECOVERY_ALLOWED_FROM[action].includes(status);
}

export function isActiveRecoveryStatus(status: RecoveryStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function isTerminalRecoveryStatus(status: RecoveryStatus): boolean {
  return !isActiveRecoveryStatus(status);
}

/* ------------------------------------------------------------------ time */

export function computeRequestExpiresAt(now: Date): Date {
  return new Date(now.getTime() + RECOVERY_REQUEST_TTL_MS);
}

export function computeCodeExpiresAt(now: Date): Date {
  return new Date(now.getTime() + RECOVERY_CODE_TTL_MS);
}

export interface ExpiryFields {
  status: RecoveryStatus;
  requestExpiresAt: Date;
  codeExpiresAt: Date | null;
}

/**
 * True when the request has run out of time and must become EXPIRED the next
 * time anything touches it: a PENDING request at its request expiry, a
 * CODE_ISSUED request at its code expiry. Final states never expire.
 */
export function isExpiryDue(request: ExpiryFields, now: Date): boolean {
  if (request.status === "PENDING") {
    return now.getTime() >= request.requestExpiresAt.getTime();
  }

  if (request.status === "CODE_ISSUED") {
    return (
      request.codeExpiresAt === null ||
      now.getTime() >= request.codeExpiresAt.getTime()
    );
  }

  return false;
}

/* ----------------------------------------------------------- eligibility */

export interface RecoveryTarget {
  role: RecoveryRole;
  membershipStatus: RecoveryMembershipStatus | null;
  /** null for a SYSTEM_ADMIN, who belongs to no village. */
  villageStatus: RecoveryVillageStatus | null;
  /** SYSTEM_ADMIN accounts other than this one (see Section 2 of the plan). */
  otherSystemAdminCount: number;
}

export type TargetCheck =
  | { ok: true }
  | { ok: false; reason: "NOT_ELIGIBLE" | "VILLAGE_NOT_ACTIVE" };

/**
 * Whether the account may take part in recovery.
 *  - SYSTEM_ADMIN: only while another System Admin exists to approve it. The
 *    last admin uses the server-side CLI instead.
 *  - CHIEF / VILLAGER: membership must be ACTIVE. With requireActiveVillage
 *    the village must be ACTIVE too (needed to file a request or to issue a
 *    code; not needed to finish a recovery that already has a code).
 */
export function evaluateTarget(
  target: RecoveryTarget,
  options: { requireActiveVillage: boolean },
): TargetCheck {
  if (target.role === "SYSTEM_ADMIN") {
    return target.otherSystemAdminCount >= 1
      ? { ok: true }
      : { ok: false, reason: "NOT_ELIGIBLE" };
  }

  if (target.membershipStatus !== "ACTIVE") {
    return { ok: false, reason: "NOT_ELIGIBLE" };
  }

  if (options.requireActiveVillage && target.villageStatus !== "ACTIVE") {
    return { ok: false, reason: "VILLAGE_NOT_ACTIVE" };
  }

  return { ok: true };
}

/* ------------------------------------------------------------- decisions */

export type RecoveryRefusal =
  | "WRONG_STATE"
  | "EXPIRED"
  | "SELF_ACTION"
  | "NOT_ELIGIBLE"
  | "VILLAGE_NOT_ACTIVE";

export type Decision = { ok: true } | { ok: false; reason: RecoveryRefusal };

const OK: Decision = { ok: true };
const refuse = (reason: RecoveryRefusal): Decision => ({ ok: false, reason });

export interface StateFields extends ExpiryFields {
  /** The account being recovered. */
  targetUserId: string;
}

/** Filing a request (public). Nothing is created unless this says ok. */
export function evaluateNewRequest(target: RecoveryTarget): Decision {
  return evaluateTarget(target, { requireActiveVillage: true });
}

/**
 * Issuing or re-issuing a code. The approver can never recover their own
 * account, and a village that is no longer ACTIVE blocks new codes.
 */
export function evaluateIssue(input: {
  request: StateFields;
  actorUserId: string;
  target: RecoveryTarget;
  now: Date;
}): Decision {
  const { request, actorUserId, target, now } = input;

  if (!canTransitionRecovery("issue", request.status)) {
    return refuse("WRONG_STATE");
  }

  if (isExpiryDue(request, now)) {
    return refuse("EXPIRED");
  }

  if (actorUserId === request.targetUserId) {
    return refuse("SELF_ACTION");
  }

  const check = evaluateTarget(target, { requireActiveVillage: true });

  return check.ok ? OK : refuse(check.reason);
}

/** Rejecting a PENDING request. Not blocked by the village's state. */
export function evaluateReject(input: {
  request: StateFields;
  actorUserId: string;
  now: Date;
}): Decision {
  const { request, actorUserId, now } = input;

  if (!canTransitionRecovery("reject", request.status)) {
    return refuse("WRONG_STATE");
  }

  if (isExpiryDue(request, now)) {
    return refuse("EXPIRED");
  }

  return actorUserId === request.targetUserId ? refuse("SELF_ACTION") : OK;
}

/** Withdrawing a live code. Not blocked by the village's state. */
export function evaluateWithdraw(input: {
  request: StateFields;
  actorUserId: string;
  now: Date;
}): Decision {
  const { request, actorUserId, now } = input;

  if (!canTransitionRecovery("withdraw", request.status)) {
    return refuse("WRONG_STATE");
  }

  if (isExpiryDue(request, now)) {
    return refuse("EXPIRED");
  }

  return actorUserId === request.targetUserId ? refuse("SELF_ACTION") : OK;
}

/**
 * Using the code. A village that is suspended or deactivated after the code
 * was issued does NOT block completion (only issuing is blocked), but the
 * account itself must still be eligible.
 */
export function evaluateRedeem(input: {
  request: StateFields;
  target: RecoveryTarget;
  now: Date;
}): Decision {
  const { request, target, now } = input;

  if (!canTransitionRecovery("redeem", request.status)) {
    return refuse("WRONG_STATE");
  }

  if (isExpiryDue(request, now)) {
    return refuse("EXPIRED");
  }

  const check = evaluateTarget(target, { requireActiveVillage: false });

  return check.ok ? OK : refuse(check.reason);
}

/** Counts a wrong code and says whether this one revokes the code. */
export function evaluateFailedRedeem(failedAttemptsBefore: number): {
  failedAttempts: number;
  revoke: boolean;
} {
  const failedAttempts = failedAttemptsBefore + 1;

  return {
    failedAttempts,
    revoke: failedAttempts >= RECOVERY_MAX_FAILED_REDEEM_ATTEMPTS,
  };
}

/* ----------------------------------------------------------------- notes */

export type NoteResult =
  | { ok: true; note: string | null }
  | {
      ok: false;
      reason: "NOT_TEXT" | "REQUIRED" | "TOO_LONG" | "INVALID_CHARACTERS";
    };

// Any control character, including line breaks: a note is one plain line.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Cleans a rejection or withdrawal note. Blank means "no note" unless one is
 * required. Length counts characters (code points), like the database, so a
 * Burmese or emoji note is not cut short by UTF-16 counting.
 */
export function normalizeRecoveryNote(
  raw: unknown,
  options: { required: boolean },
): NoteResult {
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    return { ok: false, reason: "NOT_TEXT" };
  }

  const text = (raw ?? "").trim();

  if (text.length === 0) {
    return options.required
      ? { ok: false, reason: "REQUIRED" }
      : { ok: true, note: null };
  }

  if (CONTROL_CHARACTERS.test(text)) {
    return { ok: false, reason: "INVALID_CHARACTERS" };
  }

  if (Array.from(text).length > RECOVERY_NOTE_MAX_LENGTH) {
    return { ok: false, reason: "TOO_LONG" };
  }

  return { ok: true, note: text };
}
