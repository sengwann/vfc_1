import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
  reserveRecoveryRedeem,
  reserveRecoveryRequest,
  reserveRecoveryStepUp,
} from "./recovery-throttle";

const SECRET = "s".repeat(40);

/** One row per counter, in the order the helper consumes them. */
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

const open = { attempts: 1, retryAfterSeconds: 0 };

beforeAll(() => {
  process.env.AUTH_SECRET = SECRET;
});

describe("reserveRecoveryRequest (mocked DB)", () => {
  it("counts the identifier and the IP", async () => {
    const { client, queryRaw } = fakeClient([open, open]);

    const result = await reserveRecoveryRequest(client, {
      identityKey: "village:AB12|email:aye@example.com",
      clientIp: "203.0.113.7",
    });

    expect(result).toEqual({ blocked: false, retryAfterSeconds: 0 });
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it("counts only the identifier when the client IP is unknown", async () => {
    const { client, queryRaw } = fakeClient([open]);

    const result = await reserveRecoveryRequest(client, {
      identityKey: "admin|phone:09123456789",
      clientIp: null,
    });

    expect(result.blocked).toBe(false);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("blocks when either counter is blocked and reports the longest wait", async () => {
    const { client } = fakeClient([
      { attempts: 6, retryAfterSeconds: 300 },
      { attempts: 21, retryAfterSeconds: 900 },
    ]);

    const result = await reserveRecoveryRequest(client, {
      identityKey: "village:AB12|email:aye@example.com",
      clientIp: "203.0.113.7",
    });

    expect(result).toEqual({ blocked: true, retryAfterSeconds: 900 });
  });
});

describe("reserveRecoveryRedeem (mocked DB)", () => {
  it("returns the identifier key hash so a success can clear it", async () => {
    const { client } = fakeClient([open, open]);

    const result = await reserveRecoveryRedeem(client, {
      identityKey: "user:u1",
      clientIp: "203.0.113.7",
    });

    expect(result.blocked).toBe(false);
    expect(result.identifierKeyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses a different counter per IP for the same account", async () => {
    const a = await reserveRecoveryRedeem(fakeClient([open, open]).client, {
      identityKey: "user:u1",
      clientIp: "203.0.113.7",
    });
    const b = await reserveRecoveryRedeem(fakeClient([open, open]).client, {
      identityKey: "user:u1",
      clientIp: "203.0.113.8",
    });

    expect(a.identifierKeyHash === b.identifierKeyHash).toBe(false);
  });

  it("blocks while a counter is locked", async () => {
    const { client } = fakeClient([
      { attempts: 11, retryAfterSeconds: 600 },
      open,
    ]);

    const result = await reserveRecoveryRedeem(client, {
      identityKey: "user:u1",
      clientIp: "203.0.113.7",
    });

    expect(result).toMatchObject({ blocked: true, retryAfterSeconds: 600 });
  });
});

describe("reserveRecoveryStepUp (mocked DB)", () => {
  it("counts the approver account even when the IP is unknown", async () => {
    const { client, queryRaw } = fakeClient([open]);

    const result = await reserveRecoveryStepUp(client, {
      approverUserId: "chief-1",
      clientIp: null,
    });

    expect(result.blocked).toBe(false);
    expect(result.accountKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("uses the same account counter from every IP", async () => {
    const a = await reserveRecoveryStepUp(fakeClient([open, open]).client, {
      approverUserId: "chief-1",
      clientIp: "203.0.113.7",
    });
    const b = await reserveRecoveryStepUp(fakeClient([open, open]).client, {
      approverUserId: "chief-1",
      clientIp: "198.51.100.9",
    });

    expect(a.accountKeyHash).toBe(b.accountKeyHash);
  });

  it("blocks an approver after too many wrong passwords", async () => {
    const { client } = fakeClient([
      { attempts: 6, retryAfterSeconds: 900 },
      open,
    ]);

    const result = await reserveRecoveryStepUp(client, {
      approverUserId: "chief-1",
      clientIp: "203.0.113.7",
    });

    expect(result).toMatchObject({ blocked: true, retryAfterSeconds: 900 });
  });
});
