import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    user: { updateMany: vi.fn() },
    passwordRecoveryRequest: { updateManyAndReturn: vi.fn() },
  };
  return {
    tx,
    findUnique: vi.fn(),
    transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
    requireSessionUser: vi.fn(),
    destroySession: vi.fn(),
    getSessionIdentity: vi.fn(),
    verifyPassword: vi.fn(),
    hashPassword: vi.fn(),
    createAuditLog: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/auth/session", () => ({
  destroySession: mocks.destroySession,
  getSessionIdentity: mocks.getSessionIdentity,
}));
vi.mock("@/lib/auth/guards", () => ({
  requireSessionUser: mocks.requireSessionUser,
}));
vi.mock("@/lib/auth/password", () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
}));
vi.mock("@/lib/audit", () => ({
  AuditEntityType: { USER: "USER" },
  createAuditLog: mocks.createAuditLog,
}));

import { changePasswordAction } from "./change-password.action";

function form(current: string, next: string, confirm = next): FormData {
  const data = new FormData();
  data.set("currentPassword", current);
  data.set("newPassword", next);
  data.set("confirmPassword", confirm);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSessionUser.mockResolvedValue({
    id: "u1",
    villageId: "v1",
    mustChangePassword: true,
  });
  mocks.getSessionIdentity.mockResolvedValue({ userId: "u1", sessionVersion: 3 });
  mocks.findUnique.mockResolvedValue({ passwordHash: "old-hash", sessionVersion: 3 });
  mocks.tx.user.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.passwordRecoveryRequest.updateManyAndReturn.mockResolvedValue([]);
  mocks.verifyPassword.mockResolvedValue(true);
  mocks.hashPassword.mockResolvedValue("new-hash");
});

const genericFailure = {
  success: false,
  formError: "Unable to change password. Please try again.",
};

function expectNoSuccessEffects() {
  expect(mocks.tx.passwordRecoveryRequest.updateManyAndReturn).not.toHaveBeenCalled();
  expect(mocks.createAuditLog).not.toHaveBeenCalled();
  expect(mocks.destroySession).not.toHaveBeenCalled();
}

describe("changePasswordAction", () => {
  it("clears the flag, bumps the session version, audits and ends the session", async () => {
    const result = await changePasswordAction(
      form("initial-pass", "brand-new-pass"),
    );

    expect(result).toEqual({ success: true });
    expect(mocks.tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", sessionVersion: 3, passwordHash: "old-hash" },
      data: {
        passwordHash: "new-hash",
        mustChangePassword: false,
        sessionVersion: { increment: 1 },
      },
    });
    expect(mocks.tx.passwordRecoveryRequest.updateManyAndReturn).toHaveBeenCalledWith({
      where: { userId: "u1", status: { in: ["PENDING", "CODE_ISSUED"] } },
      data: { status: "REVOKED", revokedAt: expect.any(Date), revocationReason: "PASSWORD_REPLACED", codeHash: null },
      select: { id: true },
    });
    expect(mocks.createAuditLog).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.createAuditLog.mock.calls[0][1])).not.toContain(
      "brand-new-pass",
    );
    expect(mocks.destroySession).toHaveBeenCalledTimes(1);
  });

  it("works for a user who is blocked by the gate (uses the exempt guard)", async () => {
    await expect(changePasswordAction(form("initial-pass", "brand-new-pass")))
      .resolves.toEqual({ success: true });
    expect(mocks.requireSessionUser).toHaveBeenCalledTimes(1);
  });

  it("rejects a wrong current password without changing anything", async () => {
    mocks.verifyPassword.mockResolvedValue(false);
    const result = await changePasswordAction(
      form("wrong-pass", "brand-new-pass"),
    );

    expect(result).toMatchObject({
      success: false,
      fieldErrors: { currentPassword: expect.any(String) },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });

  it("rejects a new password equal to the current one", async () => {
    const result = await changePasswordAction(
      form("same-password", "same-password"),
    );
    expect(result).toMatchObject({
      success: false,
      fieldErrors: { newPassword: expect.any(String) },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a Myanmar password longer than 72 bytes", async () => {
    const long = "က".repeat(25);
    const result = await changePasswordAction(form("initial-pass", long));
    expect(result).toMatchObject({
      success: false,
      fieldErrors: { newPassword: expect.stringContaining("72 bytes") },
    });
    expect(mocks.hashPassword).not.toHaveBeenCalled();
  });

  it.each([null, { userId: "different-user", sessionVersion: 3 }])(
    "refuses a missing or mismatched signed identity",
    async (identity) => {
      mocks.getSessionIdentity.mockResolvedValue(identity);
      await expect(changePasswordAction(form("initial-pass", "brand-new-pass")))
        .resolves.toEqual(genericFailure);
      expect(mocks.findUnique).not.toHaveBeenCalled();
      expectNoSuccessEffects();
    },
  );

  it.each([null, { passwordHash: "old-hash", sessionVersion: 4 }])(
    "refuses a missing account or a logout between the guard and credential read",
    async (credential) => {
      mocks.findUnique.mockResolvedValue(credential);
      await expect(changePasswordAction(form("initial-pass", "brand-new-pass")))
        .resolves.toEqual(genericFailure);
      expect(mocks.verifyPassword).not.toHaveBeenCalled();
      expectNoSuccessEffects();
    },
  );

  it("requires exactly one matching update before invalidation or audit", async () => {
    mocks.tx.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(changePasswordAction(form("initial-pass", "brand-new-pass")))
      .resolves.toEqual(genericFailure);
    expectNoSuccessEffects();
  });

  it("keeps the cookie and never audits success when request invalidation fails", async () => {
    mocks.tx.passwordRecoveryRequest.updateManyAndReturn.mockRejectedValueOnce(new Error("db"));
    await expect(changePasswordAction(form("initial-pass", "brand-new-pass")))
      .resolves.toEqual(genericFailure);
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });

  it("keeps the session if the transaction fails", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("db"));
    const result = await changePasswordAction(
      form("initial-pass", "brand-new-pass"),
    );
    expect(result).toMatchObject({ success: false });
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });
});
