import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    village: { findUnique: vi.fn() },
    house: { findUnique: vi.fn(), findFirst: vi.fn() },
    user: { create: vi.fn() },
    $queryRaw: vi.fn(),
  };
  return {
    tx,
    transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
    hashPassword: vi.fn(),
    getClientIp: vi.fn(),
    reserveSignupAttempt: vi.fn(),
    createAuditLog: vi.fn(),
    revalidate: vi.fn(),
    guardVillageWrite: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/db/transaction", () => ({
  withSerializableRetry: (operation: () => Promise<unknown>) => operation(),
}));
vi.mock("@/lib/auth/password", () => ({ hashPassword: mocks.hashPassword }));
vi.mock("@/lib/auth/client-ip", () => ({ getClientIp: mocks.getClientIp }));
vi.mock("@/lib/auth/login-throttle", () => ({
  reserveSignupAttempt: mocks.reserveSignupAttempt,
}));
vi.mock("@/features/household-management/lib/household-write", () => ({
  beginHouseholdWrite: mocks.guardVillageWrite,
}));
vi.mock("@/lib/audit", () => ({
  AuditEntityType: { USER: "USER" },
  createAuditLog: mocks.createAuditLog,
}));
vi.mock("../../shell/lib/shell-revalidation", () => ({
  revalidateVillageShell: mocks.revalidate,
}));

import { registerVillagerAction } from "./register-villager.action";

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  const values: Record<string, string> = {
    villageCode: "vil01",
    name: "Aung Aung",
    email: "Aung@Example.com",
    phone: "",
    password: "correct-horse",
    houseNumber: "a-12",
    dateOfBirth: "",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guardVillageWrite.mockResolvedValue({ ok: true });
  mocks.getClientIp.mockResolvedValue("203.0.113.7");
  mocks.reserveSignupAttempt.mockResolvedValue({
    blocked: false,
    retryAfterSeconds: 0,
  });
  mocks.hashPassword.mockResolvedValue("hash");
  mocks.tx.village.findUnique.mockResolvedValue({ id: "v1", status: "ACTIVE" });
  mocks.tx.house.findUnique.mockResolvedValue({ id: "h1" });
  mocks.tx.house.findFirst.mockResolvedValue({ id: "h1", isActive: true });
  // Entry locking is covered by household-write integration tests.
  mocks.tx.$queryRaw.mockResolvedValue([{ id: "h1", isActive: true }]);
  mocks.tx.user.create.mockResolvedValue({ id: "u1" });
});

describe("registerVillagerAction", () => {
  it("creates a VILLAGER in PENDING status, never a Head or privileged role", async () => {
    const result = await registerVillagerAction(
      form({ role: "CHIEF", membershipStatus: "ACTIVE", isHead: "true" }),
    );

    expect(result).toEqual({
      success: true,
      redirectTo: "/login?registered=1&village=VIL01",
    });
    const data = mocks.tx.user.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      role: "VILLAGER",
      membershipStatus: "PENDING",
      villageId: "v1",
      houseId: "h1",
      email: "aung@example.com",
    });
    expect(Object.keys(data)).not.toContain("isHead");
    expect(mocks.hashPassword).toHaveBeenCalledTimes(1);
  });

  it("stores a Myanmar phone typed with the country code as 09...", async () => {
    await registerVillagerAction(
      form({ email: "", phone: "+959 123 456 789" }),
    );
    expect(mocks.tx.user.create.mock.calls[0][0].data.phone).toBe(
      "09123456789",
    );
  });

  it("is throttled before any hashing or database work", async () => {
    mocks.reserveSignupAttempt.mockResolvedValue({
      blocked: true,
      retryAfterSeconds: 600,
    });
    const result = await registerVillagerAction(form());

    expect(result).toEqual({
      success: false,
      formError: "Too many attempts. Please try again later.",
    });
    expect(mocks.hashPassword).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects a village that is missing or not ACTIVE", async () => {
    mocks.tx.village.findUnique.mockResolvedValueOnce({
      id: "v1",
      status: "SUSPENDED",
    });
    expect(await registerVillagerAction(form())).toEqual({
      success: false,
      formError: "Invalid village code.",
    });

    mocks.tx.village.findUnique.mockResolvedValueOnce(null);
    expect(await registerVillagerAction(form())).toEqual({
      success: false,
      formError: "Invalid village code.",
    });
    expect(mocks.tx.user.create).not.toHaveBeenCalled();
  });

  it("blocks self-registration while the village is read-only, with a machine-readable code", async () => {
    mocks.guardVillageWrite.mockResolvedValue({
      ok: false,
      reason: "VILLAGE_READ_ONLY",
    });

    const result = await registerVillagerAction(form());

    expect(result).toMatchObject({ success: false, code: "VILLAGE_READ_ONLY" });
    expect(mocks.guardVillageWrite).toHaveBeenCalledWith(mocks.tx, { villageId: "v1", permission: "registration", houseNumber: "A-12" });
    expect(mocks.tx.user.create).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it("treats a village the guard reports as inactive like an invalid code", async () => {
    mocks.guardVillageWrite.mockResolvedValue({
      ok: false,
      reason: "VILLAGE_INACTIVE",
    });

    expect(await registerVillagerAction(form())).toEqual({
      success: false,
      formError: "Invalid village code.",
    });
    expect(mocks.tx.user.create).not.toHaveBeenCalled();
  });

  it("looks the house up inside the village and rejects inactive or missing houses", async () => {
    // B05 hardening: the authoritative isActive check now happens inside the
    // transaction via lockHouse ($queryRaw). Mock it to return inactive.
    mocks.tx.house.findUnique.mockResolvedValueOnce({ id: "h1" });
    mocks.tx.house.findFirst.mockResolvedValueOnce({ id: "h1", isActive: false });

    expect(await registerVillagerAction(form())).toEqual({
      success: false,
      formError: "Selected house is not available.",
    });

    mocks.tx.house.findUnique.mockResolvedValueOnce(null);
    await registerVillagerAction(form());
    expect(mocks.tx.house.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          villageId_houseNumber: { villageId: "v1", houseNumber: "A-12" },
        },
      }),
    );
    expect(mocks.tx.user.create).not.toHaveBeenCalled();
  });

  it("maps a duplicate email in the village to the email field", async () => {
    mocks.tx.user.create.mockRejectedValueOnce(
      Object.assign(new Error("x"), {
        code: "P2002",
        meta: { target: ["villageId", "email"] },
      }),
    );
    expect(await registerVillagerAction(form())).toEqual({
      success: false,
      fieldErrors: { email: "An account with this email already exists." },
    });
  });

  it("maps a duplicate phone in the village to the phone field", async () => {
    mocks.tx.user.create.mockRejectedValueOnce(
      Object.assign(new Error("x"), {
        code: "P2002",
        meta: { target: ["villageId", "phone"] },
      }),
    );
    expect(
      await registerVillagerAction(form({ email: "", phone: "09123456789" })),
    ).toEqual({
      success: false,
      fieldErrors: { phone: "An account with this phone already exists." },
    });
  });

  it("returns a form error when the unique violation names neither field", async () => {
    mocks.tx.user.create.mockRejectedValueOnce(
      Object.assign(new Error("x"), { code: "P2002" }),
    );
    expect(await registerVillagerAction(form())).toEqual({
      success: false,
      formError: "An account with those details already exists.",
    });
  });

  it("returns the password bytes error for an over-long Myanmar password", async () => {
    const result = await registerVillagerAction(
      form({ password: "က".repeat(25) }),
    );
    expect(result).toMatchObject({
      success: false,
      fieldErrors: { password: expect.stringContaining("72 bytes") },
    });
    expect(mocks.hashPassword).not.toHaveBeenCalled();
  });
});
