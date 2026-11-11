import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = { user: { update: vi.fn() } };
  return {
    tx,
    findUnique: vi.fn(),
    transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
    requireSessionUser: vi.fn(),
    destroySession: vi.fn(),
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
  revokeUserSessions: vi.fn(),
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
  mocks.findUnique.mockResolvedValue({ id: "u1", passwordHash: "old-hash" });
  mocks.verifyPassword.mockResolvedValue(true);
  mocks.hashPassword.mockResolvedValue("new-hash");
});

describe("changePasswordAction", () => {
  it("clears the flag, bumps the session version, audits and ends the session", async () => {
    const result = await changePasswordAction(
      form("initial-pass", "brand-new-pass"),
    );

    expect(result).toEqual({ success: true });
    expect(mocks.tx.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        passwordHash: "new-hash",
        mustChangePassword: false,
        sessionVersion: { increment: 1 },
      },
    });
    expect(mocks.createAuditLog).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.createAuditLog.mock.calls[0][1])).not.toContain(
      "brand-new-pass",
    );
    expect(mocks.destroySession).toHaveBeenCalledTimes(1);
  });

  it("works for a user who is blocked by the gate (uses the exempt guard)", async () => {
    await changePasswordAction(form("initial-pass", "brand-new-pass"));
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

  it("keeps the session if the transaction fails", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("db"));
    const result = await changePasswordAction(
      form("initial-pass", "brand-new-pass"),
    );
    expect(result).toMatchObject({ success: false });
    expect(mocks.destroySession).not.toHaveBeenCalled();
  });
});
