import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import {
  LOGIN_THROTTLE_COOLDOWN_SECONDS,
  LOGIN_THROTTLE_IDENTIFIER_MAX_ATTEMPTS,
  LOGIN_THROTTLE_IP_MAX_ATTEMPTS,
  LOGIN_THROTTLE_RETENTION_SECONDS,
  LOGIN_THROTTLE_WINDOW_SECONDS,
  SIGNUP_THROTTLE_IP_MAX_ATTEMPTS,
} from "./auth.constants";

/*
 * DB-backed login throttle.
 *
 * Every attempt is counted BEFORE the password is checked, using one atomic
 * INSERT ... ON CONFLICT DO UPDATE, so parallel requests cannot all slip past
 * a check-then-record race. Time comes from the database clock only, so
 * several app instances agree. Only HMAC hashes are stored: never raw
 * identifiers, user ids or IP addresses.
 *
 * Counting rules per row:
 *  - Locked row (lockedUntil in the future): attempts still increment, but the
 *    lock is NOT extended, so an attacker cannot keep a victim locked forever.
 *  - Expired lock or expired window: counters restart at 1.
 *  - Otherwise attempts + 1; exceeding maxAttempts starts the cooldown.
 */

export type LoginThrottleScope =
  | "IDENTIFIER_IP"
  | "IP"
  | "SIGNUP_IP"
  // Password recovery (see features/password-recovery/lib/recovery-throttle.ts).
  // They live in the same table with scopes of their own, so a login lockout
  // never blocks recovery and a recovery lockout never blocks sign-in.
  | "RECOVERY_REQUEST_IP"
  | "RECOVERY_REQUEST_IDENTIFIER"
  | "RECOVERY_REDEEM_IDENTIFIER_IP"
  | "RECOVERY_REDEEM_IP"
  | "RECOVERY_STEPUP_ACCOUNT"
  | "RECOVERY_STEPUP_IP";

export interface ThrottlePolicy {
  maxAttempts: number;
  windowSeconds: number;
  cooldownSeconds: number;
}

export interface ThrottleConsumeResult {
  attempts: number;
  blocked: boolean;
  retryAfterSeconds: number;
  /** True only for the attempt that started the cooldown. */
  newlyLocked: boolean;
}

export interface LoginLockout {
  scope: LoginThrottleScope;
  /** Short non-reversible fingerprint, safe to store in audit metadata. */
  keyFingerprint: string;
  attemptLimit: number;
  cooldownSeconds: number;
}

export interface LoginAttemptReservation {
  blocked: boolean;
  retryAfterSeconds: number;
  /** Hash of the identifier+IP row; cleared after a successful sign-in. */
  identifierKeyHash: string;
  newLockouts: LoginLockout[];
}

export const IDENTIFIER_IP_POLICY: ThrottlePolicy = {
  maxAttempts: LOGIN_THROTTLE_IDENTIFIER_MAX_ATTEMPTS,
  windowSeconds: LOGIN_THROTTLE_WINDOW_SECONDS,
  cooldownSeconds: LOGIN_THROTTLE_COOLDOWN_SECONDS,
};

export const IP_POLICY: ThrottlePolicy = {
  maxAttempts: LOGIN_THROTTLE_IP_MAX_ATTEMPTS,
  windowSeconds: LOGIN_THROTTLE_WINDOW_SECONDS,
  cooldownSeconds: LOGIN_THROTTLE_COOLDOWN_SECONDS,
};

export const SIGNUP_IP_POLICY: ThrottlePolicy = {
  maxAttempts: SIGNUP_THROTTLE_IP_MAX_ATTEMPTS,
  windowSeconds: LOGIN_THROTTLE_WINDOW_SECONDS,
  cooldownSeconds: LOGIN_THROTTLE_COOLDOWN_SECONDS,
};

const KEY_LABEL = "login-throttle:v1";
const NO_IP = "no-ip";
const CLEANUP_PROBABILITY = 0.02;

export function getThrottleSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required.");
  if (secret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters.");
  }
  return secret;
}

/** HMAC-SHA-256 of `${scope}\0${value}` under a key derived from `secret`. */
export function hashThrottleKey(
  secret: string,
  scope: LoginThrottleScope,
  value: string,
): string {
  const derivedKey = createHmac("sha256", secret).update(KEY_LABEL).digest();
  return createHmac("sha256", derivedKey)
    .update(`${scope}\u0000${value}`)
    .digest("hex");
}

const NOW_UTC = Prisma.raw("(now() AT TIME ZONE 'utc')");

interface ConsumeRow {
  attempts: number | bigint;
  retryAfterSeconds: number | bigint;
}

export async function consumeThrottleAttempt(
  client: PrismaClient,
  scope: LoginThrottleScope,
  keyHash: string,
  policy: ThrottlePolicy,
): Promise<ThrottleConsumeResult> {
  const expired = Prisma.sql`(
    ("LoginThrottleState"."lockedUntil" IS NOT NULL
      AND "LoginThrottleState"."lockedUntil" <= ${NOW_UTC})
    OR ("LoginThrottleState"."lockedUntil" IS NULL
      AND "LoginThrottleState"."windowStartedAt"
          + make_interval(secs => ${policy.windowSeconds}::double precision)
          <= ${NOW_UTC})
  )`;

  const rows = await client.$queryRaw<ConsumeRow[]>`
    INSERT INTO "LoginThrottleState"
      ("id", "scope", "keyHash", "attempts", "windowStartedAt", "lockedUntil", "createdAt", "updatedAt")
    VALUES
      (${randomUUID()}, ${scope}, ${keyHash}, 1, ${NOW_UTC}, NULL, ${NOW_UTC}, ${NOW_UTC})
    ON CONFLICT ("scope", "keyHash") DO UPDATE SET
      "attempts" = CASE
        WHEN ${expired} THEN 1
        ELSE "LoginThrottleState"."attempts" + 1
      END,
      "windowStartedAt" = CASE
        WHEN ${expired} THEN ${NOW_UTC}
        ELSE "LoginThrottleState"."windowStartedAt"
      END,
      "lockedUntil" = CASE
        WHEN ${expired} THEN NULL
        WHEN "LoginThrottleState"."lockedUntil" IS NOT NULL
          THEN "LoginThrottleState"."lockedUntil"
        WHEN "LoginThrottleState"."attempts" + 1 > ${policy.maxAttempts}::int
          THEN ${NOW_UTC} + make_interval(secs => ${policy.cooldownSeconds}::double precision)
        ELSE NULL
      END,
      "updatedAt" = ${NOW_UTC}
    RETURNING
      "LoginThrottleState"."attempts" AS "attempts",
      CASE
        WHEN "LoginThrottleState"."lockedUntil" IS NOT NULL
          AND "LoginThrottleState"."lockedUntil" > ${NOW_UTC}
        THEN CEIL(EXTRACT(EPOCH FROM ("LoginThrottleState"."lockedUntil" - ${NOW_UTC})))::int
        ELSE 0
      END AS "retryAfterSeconds"
  `;

  const row = rows[0];
  if (!row) {
    throw new Error("Login throttle update returned no row.");
  }

  const attempts = Number(row.attempts);
  const retryAfterSeconds = Number(row.retryAfterSeconds);
  const blocked = retryAfterSeconds > 0;

  return {
    attempts,
    blocked,
    retryAfterSeconds,
    newlyLocked: blocked && attempts === policy.maxAttempts + 1,
  };
}

export async function resetThrottle(
  client: PrismaClient,
  scope: LoginThrottleScope,
  keyHash: string,
): Promise<void> {
  await client.loginThrottleState.deleteMany({ where: { scope, keyHash } });
}

export interface ReserveLoginAttemptInput {
  /** `user:<id>` for a known account, else `identifier:<type>:<value>`. */
  identityKey: string;
  /** Trusted client IP, or null when it cannot be determined. */
  clientIp: string | null;
}

/**
 * Counts one login attempt against the identifier+IP scope and, when the
 * client IP is known, the IP-wide scope. Returns whether the attempt must be
 * rejected without checking the password.
 *
 * Without an IP only the identifier scope is enforced. A shared "unknown IP"
 * bucket is deliberately not used, since one attacker would lock out everyone.
 */
export async function reserveLoginAttempt(
  client: PrismaClient,
  input: ReserveLoginAttemptInput,
): Promise<LoginAttemptReservation> {
  const secret = getThrottleSecret();

  const identifierKeyHash = hashThrottleKey(
    secret,
    "IDENTIFIER_IP",
    `${input.identityKey}|${input.clientIp ?? NO_IP}`,
  );

  const consumers: Array<{
    scope: LoginThrottleScope;
    keyHash: string;
    policy: ThrottlePolicy;
  }> = [
    {
      scope: "IDENTIFIER_IP",
      keyHash: identifierKeyHash,
      policy: IDENTIFIER_IP_POLICY,
    },
  ];

  if (input.clientIp) {
    consumers.push({
      scope: "IP",
      keyHash: hashThrottleKey(secret, "IP", input.clientIp),
      policy: IP_POLICY,
    });
  }

  const results = await Promise.all(
    consumers.map((consumer) =>
      consumeThrottleAttempt(
        client,
        consumer.scope,
        consumer.keyHash,
        consumer.policy,
      ),
    ),
  );

  const newLockouts: LoginLockout[] = [];
  let retryAfterSeconds = 0;
  let blocked = false;

  results.forEach((result, index) => {
    const consumer = consumers[index];
    if (result.blocked) {
      blocked = true;
      retryAfterSeconds = Math.max(retryAfterSeconds, result.retryAfterSeconds);
    }
    if (result.newlyLocked) {
      newLockouts.push({
        scope: consumer.scope,
        keyFingerprint: consumer.keyHash.slice(0, 12),
        attemptLimit: consumer.policy.maxAttempts,
        cooldownSeconds: consumer.policy.cooldownSeconds,
      });
    }
  });

  return { blocked, retryAfterSeconds, identifierKeyHash, newLockouts };
}

export interface SignupAttemptReservation {
  blocked: boolean;
  retryAfterSeconds: number;
}

/**
 * Counts one signup-flow request (village-code check or registration) against
 * the client IP. Village codes are short, so without this anyone could try
 * them one after another, and every registration costs a bcrypt hash.
 *
 * Without a known client IP nothing is counted, for the same reason as the
 * login throttle: one shared "unknown IP" bucket would lock everybody out.
 */
export async function reserveSignupAttempt(
  client: PrismaClient,
  input: { clientIp: string | null },
): Promise<SignupAttemptReservation> {
  if (!input.clientIp) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  const secret = getThrottleSecret();
  const result = await consumeThrottleAttempt(
    client,
    "SIGNUP_IP",
    hashThrottleKey(secret, "SIGNUP_IP", input.clientIp),
    SIGNUP_IP_POLICY,
  );

  return {
    blocked: result.blocked,
    retryAfterSeconds: result.retryAfterSeconds,
  };
}

/**
 * Clears only the identifier+IP counter after a successful sign-in. The
 * IP-wide counter is intentionally left alone so one valid account cannot
 * reset the IP limit between guesses. Best-effort: a failure here must not
 * fail an otherwise valid sign-in.
 */
export async function clearLoginThrottle(
  client: PrismaClient,
  identifierKeyHash: string,
): Promise<void> {
  try {
    await resetThrottle(client, "IDENTIFIER_IP", identifierKeyHash);
  } catch {
    // The counter will simply expire with its window.
  }
}

/** Occasionally deletes stale rows. Best-effort, never throws. */
export async function maybeCleanupLoginThrottle(
  client: PrismaClient,
): Promise<void> {
  if (Math.random() >= CLEANUP_PROBABILITY) return;
  try {
    await client.loginThrottleState.deleteMany({
      where: {
        updatedAt: {
          lt: new Date(Date.now() - LOGIN_THROTTLE_RETENTION_SECONDS * 1000),
        },
      },
    });
  } catch {
    // Cleanup is opportunistic.
  }
}
