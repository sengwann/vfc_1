import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    village: { findUnique: vi.fn(), create: vi.fn() },
    user: { create: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  return {
    tx,
    transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
    requireSystemAdmin: vi.fn(),
    hashPassword: vi.fn(),
    createAuditLog: vi.fn(),
  };
});

vi.mock("../../../lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("../../../lib/authz", () => ({
  requireSystemAdmin: mocks.requireSystemAdmin,
}));
vi.mock("../../../lib/auth/password", () => ({
  hashPassword: mocks.hashPassword,
}));
vi.mock("../../../lib/audit", () => ({
  AuditEntityType: { VILLAGE: "VILLAGE", USER: "USER" },
  createAuditLog: mocks.createAuditLog,
}));
vi.mock("../../../lib/db/transaction", () => ({
  isSerializationConflict: () => false,
  withSerializableRetry: (operation: () => Promise<unknown>) => operation(),
}));

import { createVillageAction } from "./create-village.action";

function form(): FormData {
  const data = new FormData();
  data.set("villageCode", "NEW01");
  data.set("villageName", "New Village");
  data.set("chiefName", "Chief Name");
  data.set("chiefEmail", "chief@example.com");
  data.set("chiefPhone", "");
  data.set("chiefPassword", "initial-pass-1");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.$queryRaw.mockResolvedValue([]);
  mocks.requireSystemAdmin.mockResolvedValue({ id: "admin1" });
  mocks.hashPassword.mockResolvedValue("hash");
  mocks.tx.village.findUnique.mockResolvedValue(null);
  mocks.tx.village.create.mockResolvedValue({ id: "v1" });
  mocks.tx.user.create.mockResolvedValue({ id: "c1" });
});

describe("createVillageAction", () => {
  it("creates the Chief with the must-change-password flag set", async () => {
    const result = await createVillageAction(form());

    expect(result).toEqual({ success: true, villageId: "v1" });
    expect(mocks.tx.user.create.mock.calls[0][0].data).toMatchObject({
      role: "CHIEF",
      villageId: "v1",
      email: "chief@example.com",
      mustChangePassword: true,
    });
  });

  it("does not put the password or the flag secrets in audit metadata", async () => {
    await createVillageAction(form());
    const serialized = JSON.stringify(mocks.createAuditLog.mock.calls);
    expect(serialized).not.toContain("initial-pass-1");
    expect(serialized).not.toContain("chief@example.com");
  });

  it("reports an existing village code", async () => {
    mocks.tx.village.findUnique.mockResolvedValue({ id: "other" });
    const result = await createVillageAction(form());
    expect(result).toEqual({
      success: false,
      fieldErrors: { villageCode: "CODE_EXISTS" },
    });
    expect(mocks.tx.user.create).not.toHaveBeenCalled();
  });
});

vi.mock("@/features/village-management/lib/lifecycle-authority", () => ({ hasLifecycleAuthority: vi.fn().mockResolvedValue(true) }));

it("does not create a Chief or audit when bootstrap scope acquisition fails", async () => {
  mocks.tx.$queryRaw.mockRejectedValue(Object.assign(new Error("VFC_SCOPE_MISSING"), { code: "P0001" }));
  expect(await createVillageAction(form())).toMatchObject({ success: false, formError: "GENERIC" });
  expect(mocks.tx.user.create).not.toHaveBeenCalled();
  expect(mocks.createAuditLog).not.toHaveBeenCalled();
});
