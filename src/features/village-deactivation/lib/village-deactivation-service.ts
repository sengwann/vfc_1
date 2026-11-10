import "server-only";

import { Prisma } from "@prisma/client";

import { withSerializableRetry } from "../../../lib/db/transaction";
import { isUniqueViolation } from "../../../lib/db/unique-violation";
import { prisma } from "../../../lib/prisma";
import { parseDeactivationConfig } from "./deactivation-config";
import { deliverDeactivationNotifications } from "./deactivation-notifications";
import {
  approveDeactivationRequestInTx,
  cancelDeactivationRequestInTx,
  completeDeactivationRequestInTx,
  rejectDeactivationRequestInTx,
  submitDeactivationRequestInTx,
  type ApproveOutcome,
  type CancelOutcome,
  type CompleteOutcome,
  type RejectOutcome,
  type SubmitOutcome,
} from "./deactivation-transitions";

/*
 * Entry points for the Village Deactivation Workflow. Each one runs its
 * transition in a Serializable transaction with the project's retry helper,
 * exactly like changeVillageStatus. Callers (the Phase 5 actions and the
 * Phase 7 worker) authenticate first; the transitions then re-check the actor
 * against the database.
 *
 * A serialization conflict that survives every retry is rethrown; callers map
 * it with isSerializationConflict, the same way run-lifecycle-action.ts does.
 */

const SERIALIZABLE = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const;

/**
 * Post-commit, best effort. Runs after the transition's transaction has
 * committed, outside it, and never throws (deliverDeactivationNotifications
 * catches everything), so a notification problem cannot change, delay or roll
 * back the workflow. The worker re-runs the same idempotent sync later.
 */
async function notify(requestId: string, event: string): Promise<void> {
  try {
    await deliverDeactivationNotifications(prisma, requestId, event, {
      reminderOffsetsMs: parseDeactivationConfig(process.env).reminderOffsetsMs,
    });
  } catch {
    // Even a bad configuration value must not affect the workflow.
  }
}

export async function submitDeactivationRequest(params: {
  actorUserId: string;
  villageId: string;
  reason: unknown;
}): Promise<SubmitOutcome> {
  try {
    const outcome = await withSerializableRetry(() =>
      prisma.$transaction(
        (tx) => submitDeactivationRequestInTx(tx, params),
        SERIALIZABLE,
      ),
    );

    if (outcome.kind === "created") {
      await notify(outcome.requestId, "requested");
    }

    return outcome;
  } catch (error) {
    // The partial unique index is the last line of defense against two
    // simultaneous submissions: the loser sees an unresolved request.
    if (isUniqueViolation(error)) {
      return { kind: "blocked", reason: "UNRESOLVED_REQUEST_EXISTS" };
    }

    throw error;
  }
}

export async function approveDeactivationRequest(params: {
  requestId: string;
  actorUserId: string;
}): Promise<ApproveOutcome> {
  const outcome = await withSerializableRetry(() =>
    prisma.$transaction(
      (tx) => approveDeactivationRequestInTx(tx, params),
      SERIALIZABLE,
    ),
  );

  if (outcome.kind === "approved") {
    await notify(outcome.requestId, "approved");
  }

  return outcome;
}

export async function rejectDeactivationRequest(params: {
  requestId: string;
  actorUserId: string;
  reason: unknown;
  /** From parseDeactivationConfig(process.env).rejectionCooldownMs. */
  cooldownMs: number;
}): Promise<RejectOutcome> {
  const outcome = await withSerializableRetry(() =>
    prisma.$transaction(
      (tx) => rejectDeactivationRequestInTx(tx, params),
      SERIALIZABLE,
    ),
  );

  if (outcome.kind === "rejected") {
    await notify(outcome.requestId, "rejected");
  }

  return outcome;
}

export async function cancelDeactivationRequest(params: {
  requestId: string;
  actorUserId: string;
  villageId: string;
  reason: unknown;
}): Promise<CancelOutcome> {
  const outcome = await withSerializableRetry(() =>
    prisma.$transaction(
      (tx) => cancelDeactivationRequestInTx(tx, params),
      SERIALIZABLE,
    ),
  );

  if (outcome.kind === "cancelled") {
    await notify(outcome.requestId, "cancelled");
  }

  return outcome;
}

/** Used by the Phase 7 worker; also safe to call twice (idempotent). */
export async function completeDeactivationRequest(params: {
  requestId: string;
  completedBy?: string;
}): Promise<CompleteOutcome> {
  const outcome = await withSerializableRetry(() =>
    prisma.$transaction(
      (tx) => completeDeactivationRequestInTx(tx, params),
      SERIALIZABLE,
    ),
  );

  if (outcome.kind === "completed") {
    await notify(outcome.requestId, "completed");
  }

  return outcome;
}
