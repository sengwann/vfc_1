/*
 * Pure Village Deactivation Workflow rules. No imports, so it can be unit
 * tested directly (same approach as village-lifecycle-rules.ts). Every function
 * takes the current time as an argument; nothing here reads a clock, the
 * database or the environment.
 *
 * Workflow state (DeactivationRequestStatus) is separate from lifecycle state
 * (VillageStatus). Read-only mode is "the village has an APPROVED request", not
 * a lifecycle status.
 *
 * Transitions:
 *   approve   PENDING            -> APPROVED   (village must be ACTIVE)
 *   reject    PENDING            -> REJECTED   (starts the resubmission cooldown)
 *   cancel    APPROVED           -> CANCELLED  (only strictly before the deadline)
 *   complete  APPROVED           -> COMPLETED  (only at or after the deadline)
 *
 * The deadline is a single instant. At any moment exactly one of "cancel is
 * still possible" (now < deadline) and "completion is due" (now >= deadline)
 * is true, so the two can never both be valid. The database CHECK constraints
 * use the same boundary (cancelledAt < deadline, completedAt >= deadline).
 */

export type DeactivationRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "COMPLETED";

export type DeactivationVillageStatus = "ACTIVE" | "SUSPENDED" | "DEACTIVATED";

export type DeactivationAction = "approve" | "reject" | "cancel" | "complete";

/** The countdown is fixed by the workflow rules and is not configurable. */
export const DEACTIVATION_COUNTDOWN_HOURS = 24;
export const DEACTIVATION_COUNTDOWN_MS =
  DEACTIVATION_COUNTDOWN_HOURS * 60 * 60 * 1000;

/** Statuses that count as "unresolved": at most one per village. */
export const UNRESOLVED_STATUSES: readonly DeactivationRequestStatus[] = [
  "PENDING",
  "APPROVED",
];

export const DEACTIVATION_ALLOWED_FROM: Record<
  DeactivationAction,
  readonly DeactivationRequestStatus[]
> = {
  approve: ["PENDING"],
  reject: ["PENDING"],
  cancel: ["APPROVED"],
  complete: ["APPROVED"],
};

export const DEACTIVATION_TARGET_STATUS: Record<
  DeactivationAction,
  DeactivationRequestStatus
> = {
  approve: "APPROVED",
  reject: "REJECTED",
  cancel: "CANCELLED",
  complete: "COMPLETED",
};

export function canTransitionRequest(
  action: DeactivationAction,
  status: DeactivationRequestStatus,
): boolean {
  return DEACTIVATION_ALLOWED_FROM[action].includes(status);
}

export function isUnresolved(status: DeactivationRequestStatus): boolean {
  return UNRESOLVED_STATUSES.includes(status);
}

/**
 * The read-only rule. Only an APPROVED request makes a village read-only; a
 * PENDING request restricts nothing.
 */
export function isReadOnlyStatus(status: DeactivationRequestStatus): boolean {
  return status === "APPROVED";
}

/** approvedAt + 24h. Written once at approval and never recalculated. */
export function computeScheduledDeactivationAt(approvedAt: Date): Date {
  return new Date(approvedAt.getTime() + DEACTIVATION_COUNTDOWN_MS);
}

/** rejectedAt + the configured cooldown. */
export function computeCooldownEndsAt(
  rejectedAt: Date,
  cooldownMs: number,
): Date {
  return new Date(rejectedAt.getTime() + cooldownMs);
}

export function hasDeadlineReached(deadline: Date, now: Date): boolean {
  return now.getTime() >= deadline.getTime();
}

export type RequestBlockReason =
  | "VILLAGE_NOT_ACTIVE"
  | "UNRESOLVED_REQUEST_EXISTS"
  | "COOLDOWN_ACTIVE";

export type RequestEvaluation =
  | { ok: true }
  | {
      ok: false;
      reason: RequestBlockReason;
      /** Present for COOLDOWN_ACTIVE: when the Chief may submit again. */
      cooldownEndsAt?: Date;
    };

export interface RequestEvaluationInput {
  villageStatus: DeactivationVillageStatus;
  /** Statuses of every existing request of this village. */
  existingStatuses: readonly DeactivationRequestStatus[];
  /** Latest cooldownEndsAt among this village's REJECTED requests, if any. */
  latestCooldownEndsAt: Date | null;
  now: Date;
}

/**
 * Whether a Chief may submit a new request. The Chief's identity and role are
 * checked elsewhere; this is the state part of the decision.
 */
export function evaluateNewRequest(
  input: RequestEvaluationInput,
): RequestEvaluation {
  if (input.villageStatus !== "ACTIVE") {
    return { ok: false, reason: "VILLAGE_NOT_ACTIVE" };
  }

  if (input.existingStatuses.some(isUnresolved)) {
    return { ok: false, reason: "UNRESOLVED_REQUEST_EXISTS" };
  }

  if (
    input.latestCooldownEndsAt &&
    input.now.getTime() < input.latestCooldownEndsAt.getTime()
  ) {
    return {
      ok: false,
      reason: "COOLDOWN_ACTIVE",
      cooldownEndsAt: input.latestCooldownEndsAt,
    };
  }

  return { ok: true };
}

export type DecisionBlockReason = "NOT_PENDING" | "VILLAGE_NOT_ACTIVE";

export type DecisionEvaluation =
  | { ok: true }
  | { ok: false; reason: DecisionBlockReason };

/**
 * Approval needs a PENDING request on an ACTIVE village. A SUSPENDED village
 * must be reactivated first.
 */
export function evaluateApproval(input: {
  status: DeactivationRequestStatus;
  villageStatus: DeactivationVillageStatus;
}): DecisionEvaluation {
  if (!canTransitionRequest("approve", input.status)) {
    return { ok: false, reason: "NOT_PENDING" };
  }

  if (input.villageStatus !== "ACTIVE") {
    return { ok: false, reason: "VILLAGE_NOT_ACTIVE" };
  }

  return { ok: true };
}

/** Rejection needs only a PENDING request; the village stays as it is. */
export function evaluateRejection(input: {
  status: DeactivationRequestStatus;
}): DecisionEvaluation {
  if (!canTransitionRequest("reject", input.status)) {
    return { ok: false, reason: "NOT_PENDING" };
  }

  return { ok: true };
}

export type CancellationBlockReason =
  | "NOT_APPROVED"
  | "MISSING_DEADLINE"
  | "DEADLINE_REACHED";

export type CancellationEvaluation =
  | { ok: true }
  | { ok: false; reason: CancellationBlockReason };

/**
 * Cancellation needs an APPROVED request and a deadline strictly in the
 * future. Once the deadline is reached it is refused even if the worker has not
 * run yet.
 */
export function evaluateCancellation(input: {
  status: DeactivationRequestStatus;
  scheduledDeactivationAt: Date | null;
  now: Date;
}): CancellationEvaluation {
  if (!canTransitionRequest("cancel", input.status)) {
    return { ok: false, reason: "NOT_APPROVED" };
  }

  if (!input.scheduledDeactivationAt) {
    return { ok: false, reason: "MISSING_DEADLINE" };
  }

  if (hasDeadlineReached(input.scheduledDeactivationAt, input.now)) {
    return { ok: false, reason: "DEADLINE_REACHED" };
  }

  return { ok: true };
}

export type CompletionBlockReason =
  | "NOT_APPROVED"
  | "MISSING_DEADLINE"
  | "NOT_DUE"
  | "VILLAGE_ALREADY_DEACTIVATED";

export type CompletionEvaluation =
  | { ok: true }
  | { ok: false; reason: CompletionBlockReason };

/**
 * Completion needs an APPROVED request whose stored deadline has been reached.
 * The deadline is read from the request, never recalculated. A SUSPENDED
 * village completes normally (deactivate is allowed from SUSPENDED).
 */
export function evaluateCompletion(input: {
  status: DeactivationRequestStatus;
  scheduledDeactivationAt: Date | null;
  villageStatus: DeactivationVillageStatus;
  now: Date;
}): CompletionEvaluation {
  if (!canTransitionRequest("complete", input.status)) {
    return { ok: false, reason: "NOT_APPROVED" };
  }

  if (!input.scheduledDeactivationAt) {
    return { ok: false, reason: "MISSING_DEADLINE" };
  }

  if (!hasDeadlineReached(input.scheduledDeactivationAt, input.now)) {
    return { ok: false, reason: "NOT_DUE" };
  }

  if (input.villageStatus === "DEACTIVATED") {
    return { ok: false, reason: "VILLAGE_ALREADY_DEACTIVATED" };
  }

  return { ok: true };
}

/**
 * Which reminder offsets (milliseconds before the deadline) are due now: the
 * reminder moment has passed and the deadline has not. A reminder missed
 * because the worker was down is still due until the deadline; the
 * notification's dedupe key keeps repeated runs from sending it twice.
 */
export function dueReminderOffsetsMs(input: {
  scheduledDeactivationAt: Date;
  offsetsMs: readonly number[];
  now: Date;
}): number[] {
  const deadline = input.scheduledDeactivationAt.getTime();
  const now = input.now.getTime();

  if (now >= deadline) {
    return [];
  }

  return input.offsetsMs.filter((offset) => now >= deadline - offset);
}

/*
 * Mutation guard decision. The database part (locking the village row and
 * looking for an APPROVED request) lives in src/lib/authz/village.ts
 * (guardVillageWrite); this is only the decision over what it read.
 */

/** Machine-readable code returned for a write blocked by read-only mode. */
export const VILLAGE_READ_ONLY_CODE = "VILLAGE_READ_ONLY" as const;

export type VillageReadOnlyCode = typeof VILLAGE_READ_ONLY_CODE;

/** English fallback text. The UI renders its own translated message. */
export const VILLAGE_READ_ONLY_MESSAGE =
  "This village is read-only because it is scheduled for deactivation. No changes can be made.";

/** Query-string contract for actions that answer with a redirect. */
export const VILLAGE_READ_ONLY_ERROR_PARAM = "error";

export type VillageWriteBlockReason = "VILLAGE_INACTIVE" | "VILLAGE_READ_ONLY";

export type VillageWriteEvaluation =
  | { ok: true }
  | { ok: false; reason: VillageWriteBlockReason };

/**
 * A village accepts writes only when it exists, is ACTIVE and has no APPROVED
 * deactivation request. Lifecycle is checked first so a missing or inactive
 * village never reports read-only. A PENDING request restricts nothing.
 */
export function evaluateVillageWrite(input: {
  villageStatus: string | null;
  hasApprovedRequest: boolean;
}): VillageWriteEvaluation {
  if (input.villageStatus !== "ACTIVE") {
    return { ok: false, reason: "VILLAGE_INACTIVE" };
  }

  if (input.hasApprovedRequest) {
    return { ok: false, reason: "VILLAGE_READ_ONLY" };
  }

  return { ok: true };
}

/** The same page with ?error=VILLAGE_READ_ONLY, for redirect-style actions. */
export function withReadOnlyError(path: string): string {
  const separator = path.includes("?") ? "&" : "?";

  return `${path}${separator}${VILLAGE_READ_ONLY_ERROR_PARAM}=${VILLAGE_READ_ONLY_CODE}`;
}
