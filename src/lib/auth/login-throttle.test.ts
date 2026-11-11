import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  hashThrottleKey,
  reserveLoginAttempt,
  reserveSignupAttempt,
} from "./login-throttle";

const SECRET = "s".repeat(40);

function fakeClient(
  rows: Array<{ attempts: number; retryAfterSeconds: number }>,
) {
  const queryRaw = vi.fn();
  for (const row of rows) {
    queryRaw.mockResolvedValueOnce([row]);
  }
  return {
    client: { $queryRaw: queryRaw } as unknown as PrismaClient,
    queryRaw,
  };
}

beforeAll(() => {
  process.env.AUTH_SECRET = SECRET;
});

describe("hashThrottleKey", () => {
  it("is deterministic hex and never contains the raw value", () => {
    const a = hashThrottleKey(SECRET, "IP", "203.0.113.7");
    const b = hashThrottleKey(SECRET, "IP", "203.0.113.7");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("203.0.113.7");
  });

  it("separates scopes, values and secrets", () => {
    const base = hashThrottleKey(SECRET, "IP", "x");
    expect(hashThrottleKey(SECRET, "IDENTIFIER_IP", "x")).not.toBe(base);
    expect(hashThrottleKey(SECRET, "IP", "y")).not.toBe(base);
    expect(hashThrottleKey("t".repeat(40), "IP", "x")).not.toBe(base);
  });
});

describe("reserveLoginAttempt (aggregation, mocked DB)", () => {
  it("allows when no scope is blocked", async () => {
    const { client, queryRaw } = fakeClient([
      { attempts: 1, retryAfterSeconds: 0 },
      { attempts: 1, retryAfterSeconds: 0 },
    ]);
    const result = await reserveLoginAttempt(client, {
      identityKey: "user:u1",
      clientIp: "203.0.113.7",
    });
    expect(result.blocked).toBe(false);
    expect(result.retryAfterSeconds).toBe(0);
    expect(result.newLockouts).toEqual([]);
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("blocks when any scope is blocked and reports the longest wait", async () => {
    const { client } = fakeClient([
      { attempts: 9, retryAfterSeconds: 120 },
      { attempts: 40, retryAfterSeconds: 600 },
    ]);
    const result = await reserveLoginAttempt(client, {
      identityKey: "user:u1",
      clientIp: "203.0.113.7",
    });
    expect(result.blocked).toBe(true);
    expect(result.retryAfterSeconds).toBe(600);
  });

  it("reports a new lockout only for the attempt that crossed the limit", async () => {
    const { client } = fakeClient([
      { attempts: 6, retryAfterSeconds: 900 },
      { attempts: 6, retryAfterSeconds: 0 },
    ]);
    const result = await reserveLoginAttempt(client, {
      identityKey: "user:u1",
      clientIp: "203.0.113.7",
    });
    expect(result.newLockouts).toHaveLength(1);
    expect(result.newLockouts[0].scope).toBe("IDENTIFIER_IP");
    expect(result.newLockouts[0].attemptLimit).toBe(5);
    expect(result.newLockouts[0].keyFingerprint).toMatch(/^[0-9a-f]{12}$/);

    const { client: later } = fakeClient([
      { attempts: 7, retryAfterSeconds: 800 },
      { attempts: 7, retryAfterSeconds: 0 },
    ]);
    const second = await reserveLoginAttempt(later, {
      identityKey: "user:u1",
      clientIp: "203.0.113.7",
    });
    expect(second.blocked).toBe(true);
    expect(second.newLockouts).toEqual([]);
  });

  it("skips the IP scope when the client IP is unknown", async () => {
    const { client, queryRaw } = fakeClient([
      { attempts: 1, retryAfterSeconds: 0 },
    ]);
    const result = await reserveLoginAttempt(client, {
      identityKey: "user:u1",
      clientIp: null,
    });
    expect(result.blocked).toBe(false);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("uses one identifier key for the same identity regardless of identifier type", async () => {
    const a = await reserveLoginAttempt(
      fakeClient([{ attempts: 1, retryAfterSeconds: 0 }]).client,
      { identityKey: "user:u1", clientIp: null },
    );
    const b = await reserveLoginAttempt(
      fakeClient([{ attempts: 1, retryAfterSeconds: 0 }]).client,
      { identityKey: "user:u1", clientIp: null },
    );
    expect(a.identifierKeyHash).toBe(b.identifierKeyHash);

    const other = await reserveLoginAttempt(
      fakeClient([{ attempts: 1, retryAfterSeconds: 0 }]).client,
      { identityKey: "user:u2", clientIp: null },
    );
    expect(other.identifierKeyHash).not.toBe(a.identifierKeyHash);
  });

  it("fails loudly without a valid AUTH_SECRET", async () => {
    const original = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "short";
    try {
      await expect(
        reserveLoginAttempt(fakeClient([]).client, {
          identityKey: "user:u1",
          clientIp: null,
        }),
      ).rejects.toThrow(/AUTH_SECRET/);
    } finally {
      process.env.AUTH_SECRET = original;
    }
  });
});

describe("reserveSignupAttempt (mocked DB)", () => {
  it("counts one attempt against the signup IP scope", async () => {
    const { client, queryRaw } = fakeClient([
      { attempts: 1, retryAfterSeconds: 0 },
    ]);
    const result = await reserveSignupAttempt(client, {
      clientIp: "203.0.113.7",
    });
    expect(result).toEqual({ blocked: false, retryAfterSeconds: 0 });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("blocks once the limit is crossed", async () => {
    const { client } = fakeClient([{ attempts: 61, retryAfterSeconds: 900 }]);
    const result = await reserveSignupAttempt(client, {
      clientIp: "203.0.113.7",
    });
    expect(result).toEqual({ blocked: true, retryAfterSeconds: 900 });
  });

  it("does not count anything without a known client IP", async () => {
    const { client, queryRaw } = fakeClient([]);
    const result = await reserveSignupAttempt(client, { clientIp: null });
    expect(result.blocked).toBe(false);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
