import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import {
  consumeThrottleAttempt,
  resetThrottle,
  type ThrottlePolicy,
} from "./login-throttle";

const url = process.env.THROTTLE_TEST_DATABASE_URL;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!url)("consumeThrottleAttempt (real database)", () => {
  let prisma: PrismaClient;
  const usedKeys: string[] = [];

  const policy: ThrottlePolicy = {
    maxAttempts: 5,
    windowSeconds: 900,
    cooldownSeconds: 900,
  };

  function newKey(): string {
    const key = `test-${randomUUID()}`;
    usedKeys.push(key);
    return key;
  }

  beforeAll(() => {
    const pool = new Pool({ connectionString: url });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  });

  afterAll(async () => {
    await prisma.loginThrottleState.deleteMany({
      where: { keyHash: { in: usedKeys } },
    });
    await prisma.$disconnect();
  });

  it("allows 5 attempts, blocks the 6th and starts the cooldown once", async () => {
    const key = newKey();
    for (let i = 1; i <= 5; i += 1) {
      const result = await consumeThrottleAttempt(prisma, "IP", key, policy);
      expect(result.blocked).toBe(false);
      expect(result.attempts).toBe(i);
    }
    const sixth = await consumeThrottleAttempt(prisma, "IP", key, policy);
    expect(sixth.blocked).toBe(true);
    expect(sixth.newlyLocked).toBe(true);
    expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
    expect(sixth.retryAfterSeconds).toBeLessThanOrEqual(900);

    const seventh = await consumeThrottleAttempt(prisma, "IP", key, policy);
    expect(seventh.blocked).toBe(true);
    expect(seventh.newlyLocked).toBe(false);
    // The cooldown is not extended by attempts made while locked.
    expect(seventh.retryAfterSeconds).toBeLessThanOrEqual(
      sixth.retryAfterSeconds,
    );
  });

  it("is atomic under concurrent attempts", async () => {
    const key = newKey();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        consumeThrottleAttempt(prisma, "IP", key, policy),
      ),
    );
    expect(results.filter((r) => !r.blocked)).toHaveLength(5);
    expect(results.filter((r) => r.blocked)).toHaveLength(15);
    expect(results.filter((r) => r.newlyLocked)).toHaveLength(1);
  });

  it("allows attempts again after the cooldown expires", async () => {
    const key = newKey();
    const fast: ThrottlePolicy = {
      maxAttempts: 2,
      windowSeconds: 1,
      cooldownSeconds: 1,
    };
    await consumeThrottleAttempt(prisma, "IP", key, fast);
    await consumeThrottleAttempt(prisma, "IP", key, fast);
    const locked = await consumeThrottleAttempt(prisma, "IP", key, fast);
    expect(locked.blocked).toBe(true);

    await sleep(1300);

    const after = await consumeThrottleAttempt(prisma, "IP", key, fast);
    expect(after.blocked).toBe(false);
    expect(after.attempts).toBe(1);
  });

  it("restarts the count when the window expires without a lock", async () => {
    const key = newKey();
    const fast: ThrottlePolicy = {
      maxAttempts: 5,
      windowSeconds: 1,
      cooldownSeconds: 1,
    };
    await consumeThrottleAttempt(prisma, "IP", key, fast);
    await consumeThrottleAttempt(prisma, "IP", key, fast);
    await sleep(1300);
    const after = await consumeThrottleAttempt(prisma, "IP", key, fast);
    expect(after.attempts).toBe(1);
  });

  it("recovers after a successful-login reset", async () => {
    const key = newKey();
    for (let i = 0; i < 4; i += 1) {
      await consumeThrottleAttempt(prisma, "IDENTIFIER_IP", key, policy);
    }
    await resetThrottle(prisma, "IDENTIFIER_IP", key);
    const next = await consumeThrottleAttempt(
      prisma,
      "IDENTIFIER_IP",
      key,
      policy,
    );
    expect(next.attempts).toBe(1);
    expect(next.blocked).toBe(false);
  });

  it("keeps scopes independent for the same key hash", async () => {
    const key = newKey();
    for (let i = 0; i < 6; i += 1) {
      await consumeThrottleAttempt(prisma, "IP", key, policy);
    }
    const other = await consumeThrottleAttempt(
      prisma,
      "IDENTIFIER_IP",
      key,
      policy,
    );
    expect(other.blocked).toBe(false);
  });
});
