import "server-only";

import { Prisma } from "@prisma/client";

import {
  getThrottleSecret,
  hashThrottleKey,
} from "../../../lib/auth/login-throttle";
import { hashPassword, verifyPassword } from "../../../lib/auth/password";
import { checkPasswordRules } from "../../../lib/auth/password-rules";
import { withSerializableRetry } from "../../../lib/db/transaction";
import { isUniqueViolation } from "../../../lib/db/unique-violation";
import { prisma } from "../../../lib/prisma";
import type { RecoveryRequestInput } from "./recovery-input";
import { deliverRecoveryNotifications } from "./recovery-notifications";
import {
  clearRecoveryRedeemThrottle,
  clearRecoveryStepUpThrottle,
  reserveRecoveryRedeem,
  reserveRecoveryRequest,
  reserveRecoveryStepUp,
} from "./recovery-throttle";
import {
  fileRecoveryRequestInTx,
  findRecoveryAccount,
  issueRecoveryCodeInTx,
  recordStepUpFailureInTx,
  redeemRecoveryCodeInTx,
  rejectRecoveryRequestInTx,
  withdrawRecoveryCodeInTx,
  type IssueOutcome,
  type RejectOutcome,
  type WithdrawOutcome,
} from "./recovery-transitions";

/*
 * Entry points for password recovery. Each one is called by a server action
 * that has already authenticated (for the approver actions) or has nothing to
 * authenticate (the two public ones). They add what the transitions leave out:
 *
 *  - throttling, counted BEFORE anything is checked (recovery-throttle.ts);
 *  - the approver's password re-entry (Safeguard 3), done OUTSIDE any
 *    transaction because bcrypt is slow;
 *  - the Serializable transaction with the project's retry helper;
 *  - notifications after commit, best effort.
 *
 * A serialization conflict that survives every retry is rethrown; the action
 * maps it to a generic "try again".
 */

const SERIALIZABLE = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const;

const FINGERPRINT_LENGTH = 16;

/**
 * A short keyed fingerprint of the client IP for the audit log. It can tell
 * "same address" from "different address" without storing the address.
 */
function fingerprintOf(clientIp: string | null): string | undefined {
  if (!clientIp) {
    return undefined;
  }

  return hashThrottleKey(
    getThrottleSecret(),
    "RECOVERY_REQUEST_IP",
    clientIp,
  ).slice(0, FINGERPRINT_LENGTH);
}

function villageKey(input: RecoveryRequestInput): string {
  return input.villageCode ? `village:${input.villageCode}` : "admin";
}

/* ---------------------------------------------------------------- request */

export type SubmitRecoveryResult =
  | { kind: "created" }
  | { kind: "ignored" }
  | { kind: "throttled" };

/**
 * The public form. The CALLER must answer every result with the same generic
 * sentence; the result exists only for tests and logging.
 */
export async function submitRecoveryRequest(params: {
  input: RecoveryRequestInput;
  clientIp: string | null;
}): Promise<SubmitRecoveryResult> {
  const { input, clientIp } = params;

  const throttle = await reserveRecoveryRequest(prisma, {
    identityKey: `${villageKey(input)}|${input.identifier.type}:${input.identifier.value}`,
    clientIp,
  });

  if (throttle.blocked) {
    return { kind: "throttled" };
  }

  const clientFingerprint = fingerprintOf(clientIp);

  try {
    const outcome = await withSerializableRetry(() =>
      prisma.$transaction(
        (tx) => fileRecoveryRequestInTx(tx, { ...input, clientFingerprint }),
        SERIALIZABLE,
      ),
    );

    if (outcome.kind === "created") {
      await deliverRecoveryNotifications(prisma, outcome.requestId, "requested");
      return { kind: "created" };
    }

    return { kind: "ignored" };
  } catch (error) {
    // The partial unique index is the last line of defense against two
    // simultaneous requests: the loser is a duplicate, i.e. a silent no-op.
    if (isUniqueViolation(error)) {
      return { kind: "ignored" };
    }

    throw error;
  }
}

/* ----------------------------------------------------------------- redeem */

export type RedeemRecoveryResult =
  | { kind: "completed" }
  | { kind: "invalid" }
  | { kind: "weak_password"; reason: "LENGTH" | "TOO_MANY_BYTES" }
  | { kind: "throttled"; retryAfterSeconds: number };

/**
 * The member uses a code and chooses a new password. `code` must already be
 * normalized (normalizeRecoveryCodeInput); a code that does not normalize never
 * reaches here, but it still costs the caller a throttle attempt, which is the
 * action's job.
 */
export async function redeemRecoveryCode(params: {
  input: RecoveryRequestInput;
  code: string;
  newPassword: string;
  clientIp: string | null;
}): Promise<RedeemRecoveryResult> {
  const { input, code, newPassword, clientIp } = params;

  const violation = checkPasswordRules(newPassword);

  if (violation) {
    return { kind: "weak_password", reason: violation };
  }

  // Known accounts share one counter however they are named; unknown ones are
  // counted by what was typed, so guessing identifiers is limited too.
  const account = await findRecoveryAccount(prisma, input);
  const identityKey = account
    ? `user:${account.id}`
    : `identifier:${villageKey(input)}:${input.identifier.type}:${input.identifier.value}`;

  const throttle = await reserveRecoveryRedeem(prisma, { identityKey, clientIp });

  if (throttle.blocked) {
    return { kind: "throttled", retryAfterSeconds: throttle.retryAfterSeconds };
  }

  // Hashed whether or not the code is right, so the work done does not depend
  // on the answer, and so bcrypt never runs inside the transaction.
  const newPasswordHash = await hashPassword(newPassword);
  const secret = getThrottleSecret();
  const clientFingerprint = fingerprintOf(clientIp);

  const outcome = await withSerializableRetry(() =>
    prisma.$transaction(
      (tx) =>
        redeemRecoveryCodeInTx(tx, {
          ...input,
          code,
          newPasswordHash,
          secret,
          clientFingerprint,
        }),
      SERIALIZABLE,
    ),
  );

  if (outcome.kind !== "completed") {
    return { kind: "invalid" };
  }

  await clearRecoveryRedeemThrottle(prisma, throttle.identifierKeyHash);
  // The member's own notice is already stored; this adds the issuer's.
  await deliverRecoveryNotifications(prisma, outcome.requestId, "completed");

  return { kind: "completed" };
}

/* ------------------------------------------------------------------ issue */

export type IssueRecoveryResult =
  | Extract<IssueOutcome, { kind: "issued" | "not_found" | "blocked" }>
  | { kind: "bad_password" }
  | { kind: "throttled"; retryAfterSeconds: number };

/**
 * Safeguard 3: the approver types their own password in THIS request, and it is
 * checked here, every time (it is never remembered, so it is single use). The
 * attempt is counted per approver account before the password is compared.
 */
export async function issueRecoveryCode(params: {
  requestId: string;
  actorUserId: string;
  password: string;
  clientIp: string | null;
}): Promise<IssueRecoveryResult> {
  const { requestId, actorUserId, password, clientIp } = params;

  const throttle = await reserveRecoveryStepUp(prisma, {
    approverUserId: actorUserId,
    clientIp,
  });

  if (throttle.blocked) {
    return { kind: "throttled", retryAfterSeconds: throttle.retryAfterSeconds };
  }

  const actor = await prisma.user.findUnique({
    where: { id: actorUserId },
    select: { passwordHash: true, villageId: true },
  });

  if (!actor) {
    return { kind: "not_found" };
  }

  const passwordIsValid = await verifyPassword(password, actor.passwordHash);

  if (!passwordIsValid) {
    await prisma.$transaction((tx) =>
      recordStepUpFailureInTx(tx, {
        actorUserId,
        requestId,
        villageId: actor.villageId,
        clientFingerprint: fingerprintOf(clientIp),
      }),
    );

    return { kind: "bad_password" };
  }

  await clearRecoveryStepUpThrottle(prisma, throttle.accountKeyHash);

  const secret = getThrottleSecret();

  return withSerializableRetry(() =>
    prisma.$transaction(
      (tx) => issueRecoveryCodeInTx(tx, { requestId, actorUserId, secret }),
      SERIALIZABLE,
    ),
  );
}

/* ---------------------------------------------------------- reject/withdraw */

export async function rejectRecoveryRequest(params: {
  requestId: string;
  actorUserId: string;
  note: unknown;
}): Promise<RejectOutcome> {
  const outcome = await withSerializableRetry(() =>
    prisma.$transaction(
      (tx) => rejectRecoveryRequestInTx(tx, params),
      SERIALIZABLE,
    ),
  );

  if (outcome.kind === "rejected") {
    await deliverRecoveryNotifications(prisma, outcome.requestId, "rejected");
  }

  return outcome;
}

export async function withdrawRecoveryCode(params: {
  requestId: string;
  actorUserId: string;
  note: unknown;
}): Promise<WithdrawOutcome> {
  return withSerializableRetry(() =>
    prisma.$transaction(
      (tx) => withdrawRecoveryCodeInTx(tx, params),
      SERIALIZABLE,
    ),
  );
}
