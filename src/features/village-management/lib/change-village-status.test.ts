import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    village: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    fund: { count: vi.fn().mockResolvedValue(0) },
    user: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    villageDeactivationRequest: {
      count: vi.fn(),
    },
  };

  return {
    tx,
    transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    createAuditLog: vi.fn(async () => ({})),
  };
});

vi.mock("../../../lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));

vi.mock("../../../lib/audit", () => ({
  AuditEntityType: { VILLAGE: "VILLAGE" },
  createAuditLog: mocks.createAuditLog,
}));

import { changeVillageStatus } from "./change-village-status";

const VILLAGE = {
  id: "v1",
  villageCode: "DEV101",
  name: "Test Village",
  status: "ACTIVE",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.village.findUnique.mockResolvedValue({ ...VILLAGE });
  mocks.tx.village.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.villageDeactivationRequest.count.mockResolvedValue(0);
});

describe("changeVillageStatus", () => {
  it("returns not_found and writes nothing when the village is missing", async () => {
    mocks.tx.village.findUnique.mockResolvedValue(null);

    const outcome = await changeVillageStatus({
      villageId: "missing",
      action: "suspend",
      actorUserId: "admin",
      reason: null,
    });

    expect(outcome).toBe("not_found");
    expect(mocks.tx.village.updateMany).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it("returns not_allowed for a transition the table forbids", async () => {
    mocks.tx.village.findUnique.mockResolvedValue({
      ...VILLAGE,
      status: "DEACTIVATED",
    });

    const outcome = await changeVillageStatus({
      villageId: "v1",
      action: "reactivate",
      actorUserId: "admin",
      reason: null,
    });

    expect(outcome).toBe("not_allowed");
    expect(mocks.tx.village.updateMany).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it("updates only Village.status, conditioned on the status read, and audits it", async () => {
    const outcome = await changeVillageStatus({
      villageId: "v1",
      action: "suspend",
      actorUserId: "admin",
      reason: "closed",
    });

    expect(outcome).toBe("ok");
    expect(mocks.tx.village.updateMany).toHaveBeenCalledWith({
      where: { id: "v1", status: "ACTIVE" },
      data: { status: "SUSPENDED" },
    });
    expect(mocks.createAuditLog).toHaveBeenCalledTimes(1);

    const [, input] = mocks.createAuditLog.mock.calls[0] as unknown as [
      unknown,
      Record<string, unknown>,
    ];
    expect(input).toMatchObject({
      actionType: "STATUS_CHANGE",
      entityType: "VILLAGE",
      entityId: "v1",
      villageId: "v1",
      actorUserId: "admin",
      metadata: {
        villageCode: "DEV101",
        name: "Test Village",
        previousStatus: "ACTIVE",
        newStatus: "SUSPENDED",
        reason: "closed",
      },
    });
  });

  it("never deactivates directly, even for a caller that bypasses the types", async () => {
    for (const status of ["ACTIVE", "SUSPENDED"]) {
      mocks.tx.village.findUnique.mockResolvedValue({ ...VILLAGE, status });

      const outcome = await changeVillageStatus({
        villageId: "v1",
        // Not allowed by the type; this simulates a bypass.
        action: "deactivate" as unknown as "suspend",
        actorUserId: "admin",
        reason: null,
      });

      expect(outcome).toBe("not_allowed");
    }

    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.tx.village.updateMany).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it("does not cascade: users are never touched", async () => {
    await changeVillageStatus({
      villageId: "v1",
      action: "suspend",
      actorUserId: "admin",
      reason: null,
    });

    expect(mocks.tx.user.update).not.toHaveBeenCalled();
    expect(mocks.tx.user.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.village.update).not.toHaveBeenCalled();
  });

  it("omits reason from the audit metadata when none is given", async () => {
    await changeVillageStatus({
      villageId: "v1",
      action: "suspend",
      actorUserId: "admin",
      reason: null,
    });

    const [, input] = mocks.createAuditLog.mock.calls[0] as unknown as [
      unknown,
      { metadata: Record<string, unknown> },
    ];
    expect(input.metadata).not.toHaveProperty("reason");
  });

  it("returns not_allowed and writes no audit when the conditional update matches no row", async () => {
    mocks.tx.village.updateMany.mockResolvedValue({ count: 0 });

    const outcome = await changeVillageStatus({
      villageId: "v1",
      action: "suspend",
      actorUserId: "admin",
      reason: null,
    });

    expect(outcome).toBe("not_allowed");
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it("refuses to suspend a village that has an approved deactivation request, writing nothing", async () => {
    mocks.tx.villageDeactivationRequest.count.mockResolvedValue(1);

    const outcome = await changeVillageStatus({
      villageId: "v1",
      action: "suspend",
      actorUserId: "admin",
      reason: null,
    });

    expect(outcome).toBe("blocked_by_deactivation");
    expect(mocks.tx.villageDeactivationRequest.count).toHaveBeenCalledWith({
      where: { villageId: "v1", status: "APPROVED" },
    });
    expect(mocks.tx.village.updateMany).not.toHaveBeenCalled();
    expect(mocks.createAuditLog).not.toHaveBeenCalled();
  });

  it("does not look for an approved request when reactivating", async () => {
    mocks.tx.village.findUnique.mockResolvedValue({
      ...VILLAGE,
      status: "SUSPENDED",
    });

    expect(
      await changeVillageStatus({
        villageId: "v1",
        action: "reactivate",
        actorUserId: "admin",
        reason: null,
      }),
    ).toBe("ok");
    expect(mocks.tx.villageDeactivationRequest.count).not.toHaveBeenCalled();
  });
});

vi.mock("@/features/village-management/lib/lifecycle-authority", () => ({ hasLifecycleAuthority: vi.fn().mockResolvedValue(true) }));
vi.mock("@/features/village-deactivation/lib/deactivation-transitions", () => ({ lockVillageForTransition: vi.fn(), lockLifecycleFunds: vi.fn().mockResolvedValue(false) }));

it("refuses suspension for any ACTIVE Fund, without an expiry filter", async () => {
  mocks.tx.fund.count.mockResolvedValueOnce(1);
  expect(await changeVillageStatus({ villageId: "v1", action: "suspend", actorUserId: "admin", reason: null })).toBe("blocked_by_active_fund");
  expect(mocks.tx.fund.count).toHaveBeenCalledWith({ where: { villageId: "v1", status: "ACTIVE" } });
  expect(mocks.tx.village.updateMany).not.toHaveBeenCalled();
  expect(mocks.createAuditLog).not.toHaveBeenCalled();
});
