import "server-only";

import type { PrismaClient } from "@prisma/client";

import {
  consumeThrottleAttempt,
  getThrottleSecret,
  hashThrottleKey,
  resetThrottle,
  type LoginThrottleScope,
  type ThrottlePolicy,
} from "../../../lib/auth/login-throttle";
import { RECOVERY_THROTTLE } from "./recovery-config";

/*
 * Throttling for password recovery. It reuses the login throttle's atomic,
 * database-clock counter (consumeThrottleAttempt) with scopes of its own, so a
 * sign-in lockout never blocks recovery and the reverse. As with sign-in, an
 * attempt is counted BEFORE anything is checked, and only HMAC hashes are
 * stored.
 *
 * Without a known client IP the IP scopes are skipped, never pooled into a
 * shared "unknown" bucket (one attacker would lock everybody out). The
 * account-scoped step-up limit does not depend on an IP at all.
 */

const NO_IP = "no-ip";

interface Counter {
  scope: LoginThrottleScope;
  keyHash: string;
  policy: ThrottlePolicy;
}

export interface RecoveryThrottleResult {
  blocked: boolean;
  /** The longest wait among the blocked counters, in seconds. */
  retryAfterSeconds: number;
}

async function consume(
  client: PrismaClient,
  counters: Counter[],
): Promise<RecoveryThrottleResult> {
  const results = await Promise.all(
    counters.map((counter) =>
      consumeThrottleAttempt(
        client,
        counter.scope,
        counter.keyHash,
        counter.policy,
      ),
    ),
  );

  return {
    blocked: results.some((result) => result.blocked),
    retryAfterSeconds: Math.max(
      0,
      ...results.map((result) => result.retryAfterSeconds),
    ),
  };
}

/**
 * One public recovery request: counted per village+identifier (limits how many
 * notifications one account can trigger) and per client IP. The caller answers
 * with the same generic sentence whether this blocks or not.
 *
 * `identityKey` must be built from the normalized form input, for example
 * `village:AB12|email:aye@example.com` or `admin|phone:09123456789`.
 */
export async function reserveRecoveryRequest(
  client: PrismaClient,
  input: { identityKey: string; clientIp: string | null },
): Promise<RecoveryThrottleResult> {
  const secret = getThrottleSecret();

  const counters: Counter[] = [
    {
      scope: "RECOVERY_REQUEST_IDENTIFIER",
      keyHash: hashThrottleKey(
        secret,
        "RECOVERY_REQUEST_IDENTIFIER",
        input.identityKey,
      ),
      policy: RECOVERY_THROTTLE.requestIdentifier,
    },
  ];

  if (input.clientIp) {
    counters.push({
      scope: "RECOVERY_REQUEST_IP",
      keyHash: hashThrottleKey(secret, "RECOVERY_REQUEST_IP", input.clientIp),
      policy: RECOVERY_THROTTLE.requestIp,
    });
  }

  return consume(client, counters);
}

export interface RecoveryRedeemReservation extends RecoveryThrottleResult {
  /** Hash of the identity+IP row; cleared after a successful redeem. */
  identifierKeyHash: string;
}

/**
 * One attempt to use a reset code. Counted per account (or identifier) per
 * client IP, and per client IP across accounts, before the code is compared.
 *
 * `identityKey` is `user:<id>` for a known account, otherwise the same
 * `identifier:...` shape sign-in uses, so unknown accounts are counted too.
 */
export async function reserveRecoveryRedeem(
  client: PrismaClient,
  input: { identityKey: string; clientIp: string | null },
): Promise<RecoveryRedeemReservation> {
  const secret = getThrottleSecret();

  const identifierKeyHash = hashThrottleKey(
    secret,
    "RECOVERY_REDEEM_IDENTIFIER_IP",
    `${input.identityKey}|${input.clientIp ?? NO_IP}`,
  );

  const counters: Counter[] = [
    {
      scope: "RECOVERY_REDEEM_IDENTIFIER_IP",
      keyHash: identifierKeyHash,
      policy: RECOVERY_THROTTLE.redeemIdentifierIp,
    },
  ];

  if (input.clientIp) {
    counters.push({
      scope: "RECOVERY_REDEEM_IP",
      keyHash: hashThrottleKey(secret, "RECOVERY_REDEEM_IP", input.clientIp),
      policy: RECOVERY_THROTTLE.redeemIp,
    });
  }

  return { ...(await consume(client, counters)), identifierKeyHash };
}

/** Clears only the identity+IP counter after a successful redeem. */
export async function clearRecoveryRedeemThrottle(
  client: PrismaClient,
  identifierKeyHash: string,
): Promise<void> {
  try {
    await resetThrottle(
      client,
      "RECOVERY_REDEEM_IDENTIFIER_IP",
      identifierKeyHash,
    );
  } catch {
    // The counter simply expires with its window.
  }
}

export interface RecoveryStepUpReservation extends RecoveryThrottleResult {
  /** Hash of the approver-account row; cleared after a correct password. */
  accountKeyHash: string;
}

/**
 * One password re-entry by an approver issuing a code. Counted per approver
 * ACCOUNT (a stolen session cannot avoid it by changing address) and per
 * client IP, before the password is checked.
 */
export async function reserveRecoveryStepUp(
  client: PrismaClient,
  input: { approverUserId: string; clientIp: string | null },
): Promise<RecoveryStepUpReservation> {
  const secret = getThrottleSecret();

  const accountKeyHash = hashThrottleKey(
    secret,
    "RECOVERY_STEPUP_ACCOUNT",
    `user:${input.approverUserId}`,
  );

  const counters: Counter[] = [
    {
      scope: "RECOVERY_STEPUP_ACCOUNT",
      keyHash: accountKeyHash,
      policy: RECOVERY_THROTTLE.stepUpAccount,
    },
  ];

  if (input.clientIp) {
    counters.push({
      scope: "RECOVERY_STEPUP_IP",
      keyHash: hashThrottleKey(secret, "RECOVERY_STEPUP_IP", input.clientIp),
      policy: RECOVERY_THROTTLE.stepUpIp,
    });
  }

  return { ...(await consume(client, counters)), accountKeyHash };
}

/** Clears the approver-account counter after a correct password. */
export async function clearRecoveryStepUpThrottle(
  client: PrismaClient,
  accountKeyHash: string,
): Promise<void> {
  try {
    await resetThrottle(client, "RECOVERY_STEPUP_ACCOUNT", accountKeyHash);
  } catch {
    // The counter simply expires with its window.
  }
}
