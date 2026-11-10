/*
 * One pass of the deactivation worker. No imports of server code or Prisma: the
 * database access (the store) and the actions (complete, deliver) are injected,
 * so the logic can be unit tested with fakes. scripts/deactivation-worker.ts
 * wires the real ones.
 *
 * A pass does two things, in this order:
 *   1. Completes every APPROVED request whose stored deadline has been reached.
 *      Completion itself is the Phase 4 transition (village DEACTIVATED,
 *      request COMPLETED, audits, one Serializable transaction); this only
 *      finds and claims the work and keeps the bookkeeping columns.
 *   2. Reconciles notifications (reminders, and delivery that failed earlier)
 *      for unresolved and recently resolved requests. Idempotent.
 *
 * Several workers (or a worker and a manual --once run) can run at once. Due
 * requests are claimed with FOR UPDATE SKIP LOCKED in a short transaction that
 * also stamps lastProcessingAt, so two workers do not take the same request,
 * and the completion transition is idempotent anyway (the loser gets
 * NOT_APPROVED and does nothing).
 */

/** A claimed request is not claimed again for this long, which bounds retries of a stuck one. */
export const CLAIM_LEASE_SECONDS = 300;

/** Resolved requests stay in the notification reconcile window this long. */
export const RECONCILE_WINDOW_SECONDS = 48 * 60 * 60;

export const RECONCILE_LIMIT = 200;

export interface WorkerStore {
  /** The database clock; the same time source as the transitions. */
  readNow(): Promise<Date>;
  /**
   * Claims up to `limit` due APPROVED requests (deadline reached, not claimed
   * within the lease), counting an attempt on each, and returns their ids.
   */
  claimDueRequests(limit: number, leaseSeconds: number): Promise<string[]>;
  /**
   * Stores the last error on a still-APPROVED request. With retryNow the claim
   * is released so the next pass retries; otherwise the lease keeps it away
   * until it expires.
   */
  recordFailure(
    requestId: string,
    message: string,
    options: { retryNow: boolean },
  ): Promise<void>;
  /** PENDING and APPROVED requests plus recently resolved ones. */
  listReconcileRequestIds(
    limit: number,
    windowSeconds: number,
  ): Promise<string[]>;
}

export type CompleteResult =
  | { kind: "completed" }
  | { kind: "not_found" }
  | { kind: "blocked"; reason: string };

export interface WorkerDeps {
  store: WorkerStore;
  complete(requestId: string): Promise<CompleteResult>;
  /** Idempotent and never throws; returns null when delivery failed. */
  deliver(
    requestId: string,
    now: Date,
  ): Promise<{ planned: number; created: number } | null>;
  batchSize: number;
  log?: (message: string, detail?: unknown) => void;
}

export interface PassResult {
  claimed: number;
  completed: number;
  /** Already resolved by someone else (cancelled, or completed by another worker). */
  alreadyResolved: number;
  /** Not completable and still APPROVED; recorded on the request. */
  blocked: number;
  failed: number;
  notificationsCreated: number;
  notificationFailures: number;
}

const ALREADY_RESOLVED_REASONS = new Set(["NOT_APPROVED"]);

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

export async function runWorkerPass(deps: WorkerDeps): Promise<PassResult> {
  const log = deps.log ?? (() => undefined);
  const result: PassResult = {
    claimed: 0,
    completed: 0,
    alreadyResolved: 0,
    blocked: 0,
    failed: 0,
    notificationsCreated: 0,
    notificationFailures: 0,
  };

  // 1. Completion. A failure on one request never stops the others.
  const claimed = await deps.store.claimDueRequests(
    deps.batchSize,
    CLAIM_LEASE_SECONDS,
  );
  result.claimed = claimed.length;

  for (const requestId of claimed) {
    try {
      const outcome = await deps.complete(requestId);

      if (outcome.kind === "completed") {
        result.completed += 1;
        log("Deactivation completed", { requestId });
      } else if (
        outcome.kind === "not_found" ||
        ALREADY_RESOLVED_REASONS.has(outcome.reason)
      ) {
        result.alreadyResolved += 1;
      } else {
        result.blocked += 1;
        log("Deactivation could not be completed", { requestId, outcome });
        await recordSafely(deps, requestId, `blocked: ${outcome.reason}`, false);
      }
    } catch (error) {
      result.failed += 1;
      log("Deactivation completion failed", { requestId, error });
      await recordSafely(deps, requestId, errorText(error), true);
    }
  }

  // 2. Notification reconcile (reminders and repair of failed deliveries).
  let reconcileIds: string[] = [];

  try {
    reconcileIds = await deps.store.listReconcileRequestIds(
      RECONCILE_LIMIT,
      RECONCILE_WINDOW_SECONDS,
    );
  } catch (error) {
    log("Listing requests for notification reconcile failed", { error });
    result.notificationFailures += 1;
  }

  if (reconcileIds.length > 0) {
    const now = await deps.store.readNow();

    for (const requestId of reconcileIds) {
      const sync = await deps.deliver(requestId, now);

      if (sync === null) {
        result.notificationFailures += 1;
      } else {
        result.notificationsCreated += sync.created;
      }
    }
  }

  return result;
}

async function recordSafely(
  deps: WorkerDeps,
  requestId: string,
  message: string,
  retryNow: boolean,
): Promise<void> {
  try {
    await deps.store.recordFailure(requestId, message, { retryNow });
  } catch (error) {
    // Bookkeeping must not stop the pass; the log still has the cause.
    (deps.log ?? (() => undefined))("Recording a processing failure failed", {
      requestId,
      error,
    });
  }
}

/** Process exit code for --once: 0 only when nothing went wrong. */
export function passExitCode(result: PassResult): number {
  return result.failed > 0 || result.blocked > 0 || result.notificationFailures > 0
    ? 1
    : 0;
}
