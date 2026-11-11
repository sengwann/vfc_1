import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  verifyPassword: vi.fn(),
  createSession: vi.fn(),
  tryCreateAuditLog: vi.fn(),
  getClientIp: vi.fn(),
  reserveLoginAttempt: vi.fn(),
  clearLoginThrottle: vi.fn(),
  maybeCleanupLoginThrottle: vi.fn(),
}));

vi.mock("../../../lib/prisma", () => ({
  prisma: { user: { findFirst: mocks.findFirst } },
}));
vi.mock("../../../lib/auth/password", () => ({
  verifyPassword: mocks.verifyPassword,
}));
vi.mock("../../../lib/auth/session", () => ({
  createSession: mocks.createSession,
}));
vi.mock("../../../lib/audit", () => ({
  AuditEntityType: { SESSION: "SESSION" },
  tryCreateAuditLog: mocks.tryCreateAuditLog,
}));
vi.mock("../../../lib/auth/client-ip", () => ({
  getClientIp: mocks.getClientIp,
}));
vi.mock("../../../lib/auth/login-throttle", () => ({
  reserveLoginAttempt: mocks.reserveLoginAttempt,
  clearLoginThrottle: mocks.clearLoginThrottle,
  maybeCleanupLoginThrottle: mocks.maybeCleanupLoginThrottle,
}));

import { UserRole, VillageStatus } from "@prisma/client";
import { loginAction } from "./login.action";

const allowed = {
  blocked: false,
  retryAfterSeconds: 0,
  identifierKeyHash: "key-hash",
  newLockouts: [] as unknown[],
};

const activeUser = {
  id: "u1",
  passwordHash: "stored-hash",
  role: UserRole.VILLAGER,
  villageId: "v1",
  village: { status: VillageStatus.ACTIVE },
};

function form(identifier: string, password = "correct-password"): FormData {
  const data = new FormData();
  data.set("identifier", identifier);
  data.set("password", password);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClientIp.mockResolvedValue("203.0.113.7");
  mocks.reserveLoginAttempt.mockResolvedValue({ ...allowed });
  mocks.findFirst.mockResolvedValue(activeUser);
  mocks.verifyPassword.mockResolvedValue(true);
  mocks.tryCreateAuditLog.mockResolvedValue(undefined);
});

describe("loginAction", () => {
  it("signs in, clears the identifier throttle and audits LOGIN", async () => {
    const result = await loginAction(form("a@b.co"));

    expect(result).toEqual({ success: true, redirectTo: "/dashboard" });
    expect(mocks.clearLoginThrottle).toHaveBeenCalledWith(
      expect.anything(),
      "key-hash",
    );
    expect(mocks.createSession).toHaveBeenCalledWith("u1");
    expect(mocks.tryCreateAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actionType: "LOGIN" }),
    );
  });

  it("returns the same generic error for unknown user and wrong password", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    const unknown = await loginAction(form("nobody@b.co"));

    mocks.verifyPassword.mockResolvedValueOnce(false);
    const wrong = await loginAction(form("a@b.co", "bad-password"));

    expect(unknown).toEqual(wrong);
    expect(unknown).toEqual({
      success: false,
      code: "INVALID_CREDENTIALS",
      error: "Invalid credentials.",
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.clearLoginThrottle).not.toHaveBeenCalled();
  });

  it("still runs a bcrypt comparison for an unknown user", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    await loginAction(form("nobody@b.co"));
    expect(mocks.verifyPassword).toHaveBeenCalledWith(
      "correct-password",
      expect.stringMatching(/^\$2b\$10\$/),
    );
  });

  it("returns the generic error for a suspended village", async () => {
    mocks.findFirst.mockResolvedValueOnce({
      ...activeUser,
      village: { status: VillageStatus.SUSPENDED },
    });
    const result = await loginAction(form("a@b.co"));
    expect(result).toMatchObject({
      success: false,
      code: "INVALID_CREDENTIALS",
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("does not count malformed input", async () => {
    const result = await loginAction(form("not valid!!"));
    expect(result).toMatchObject({
      success: false,
      code: "INVALID_CREDENTIALS",
    });
    expect(mocks.reserveLoginAttempt).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("rejects without checking the password while throttled", async () => {
    mocks.reserveLoginAttempt.mockResolvedValueOnce({
      ...allowed,
      blocked: true,
      retryAfterSeconds: 600,
    });
    const result = await loginAction(form("a@b.co"));

    expect(result).toEqual({
      success: false,
      code: "THROTTLED",
      error: "Too many sign-in attempts.",
      retryAfterSeconds: 600,
    });
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it("uses one throttle identity for email and phone of the same account", async () => {
    await loginAction(form("a@b.co"));
    await loginAction(form("0912345678"));

    const keys = mocks.reserveLoginAttempt.mock.calls.map(
      (call) => (call[1] as { identityKey: string }).identityKey,
    );
    expect(keys).toEqual(["user:u1", "user:u1"]);
  });

  it("keys unknown identifiers by normalized identifier and passes the client IP", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    await loginAction(form("Nobody@B.co"));

    expect(mocks.reserveLoginAttempt).toHaveBeenCalledWith(expect.anything(), {
      identityKey: "identifier:admin:email:nobody@b.co",
      clientIp: "203.0.113.7",
    });
  });

  it("audits a new account lockout without raw identifiers or IPs", async () => {
    mocks.reserveLoginAttempt.mockResolvedValueOnce({
      ...allowed,
      blocked: true,
      retryAfterSeconds: 900,
      newLockouts: [
        {
          scope: "IDENTIFIER_IP",
          keyFingerprint: "abcdef012345",
          attemptLimit: 5,
          cooldownSeconds: 900,
        },
      ],
    });
    await loginAction(form("a@b.co"));

    expect(mocks.tryCreateAuditLog).toHaveBeenCalledTimes(1);
    const entry = mocks.tryCreateAuditLog.mock.calls[0][1];
    expect(entry).toMatchObject({
      actionType: "LOGIN_THROTTLED",
      entityId: "u1",
      villageId: "v1",
      actorUserId: null,
    });
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain("a@b.co");
    expect(serialized).not.toContain("203.0.113.7");
    expect(serialized).not.toContain("correct-password");
  });

  it("does not audit lockouts for unknown identifiers, but audits IP lockouts", async () => {
    mocks.findFirst.mockResolvedValueOnce(null);
    mocks.reserveLoginAttempt.mockResolvedValueOnce({
      ...allowed,
      blocked: true,
      retryAfterSeconds: 900,
      newLockouts: [
        {
          scope: "IDENTIFIER_IP",
          keyFingerprint: "111111111111",
          attemptLimit: 5,
          cooldownSeconds: 900,
        },
        {
          scope: "IP",
          keyFingerprint: "222222222222",
          attemptLimit: 30,
          cooldownSeconds: 900,
        },
      ],
    });
    await loginAction(form("nobody@b.co"));

    expect(mocks.tryCreateAuditLog).toHaveBeenCalledTimes(1);
    expect(mocks.tryCreateAuditLog.mock.calls[0][1]).toMatchObject({
      actionType: "LOGIN_THROTTLED",
      entityId: null,
      villageId: null,
    });
  });

  it("propagates a throttle storage failure instead of skipping the limit", async () => {
    mocks.reserveLoginAttempt.mockRejectedValueOnce(new Error("db down"));
    await expect(loginAction(form("a@b.co"))).rejects.toThrow("db down");
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
  });
});
