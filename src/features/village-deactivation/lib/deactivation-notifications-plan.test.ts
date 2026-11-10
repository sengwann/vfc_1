import { describe, expect, it } from "vitest";

import {
  planDeactivationNotifications,
  type PlanRequest,
} from "./deactivation-notifications-plan";

const HOUR = 60 * 60 * 1000;
const T0 = new Date("2026-11-01T00:00:00.000Z");
const DEADLINE = new Date(T0.getTime() + 24 * HOUR);

const village = { name: "Test Village", villageCode: "TV1" };
const adminUserIds = ["admin-1", "admin-2"];
const chiefUserIds = ["chief-1"];

function request(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    id: "req-1",
    villageId: "village-1",
    status: "PENDING",
    reason: "Closing",
    approvedAt: null,
    scheduledDeactivationAt: null,
    rejectedAt: null,
    rejectionReason: null,
    cooldownEndsAt: null,
    cancelledAt: null,
    cancellationReason: null,
    completedAt: null,
    ...overrides,
  };
}

function plan(req: PlanRequest, now: Date = T0) {
  return planDeactivationNotifications({
    request: req,
    village,
    adminUserIds,
    chiefUserIds,
    now,
    reminderOffsetsMs: [12 * HOUR, 1 * HOUR],
  });
}

const targets = (items: ReturnType<typeof plan>, type: string) =>
  items.filter((item) => item.type === type).map((item) => item.userId);

describe("planDeactivationNotifications", () => {
  it("notifies every System Admin when a request is created", () => {
    const items = plan(request());
    expect(targets(items, "DEACTIVATION_REQUESTED")).toEqual(adminUserIds);
    expect(items).toHaveLength(2);
  });

  it("notifies the Chief on approval, with the deadline", () => {
    const items = plan(
      request({
        status: "APPROVED",
        approvedAt: T0,
        scheduledDeactivationAt: DEADLINE,
      }),
    );
    expect(targets(items, "DEACTIVATION_APPROVED")).toEqual(chiefUserIds);
    const approved = items.find((i) => i.type === "DEACTIVATION_APPROVED");
    expect(approved?.params.scheduledDeactivationAt).toBe(DEADLINE.toISOString());
  });

  it("notifies the Chief on rejection with reason and cooldown end", () => {
    const cooldown = new Date(T0.getTime() + 24 * HOUR);
    const items = plan(
      request({
        status: "REJECTED",
        rejectedAt: T0,
        rejectionReason: "Not now",
        cooldownEndsAt: cooldown,
      }),
    );
    const rejected = items.find((i) => i.type === "DEACTIVATION_REJECTED");
    expect(rejected?.userId).toBe("chief-1");
    expect(rejected?.params.rejectionReason).toBe("Not now");
    expect(rejected?.params.cooldownEndsAt).toBe(cooldown.toISOString());
  });

  it("notifies System Admins on cancellation", () => {
    const items = plan(
      request({ status: "CANCELLED", cancelledAt: T0, cancellationReason: "Changed mind" }),
    );
    expect(targets(items, "DEACTIVATION_CANCELLED")).toEqual(adminUserIds);
  });

  it("notifies System Admins only on completion, never village users", () => {
    const items = plan(
      request({
        status: "COMPLETED",
        approvedAt: T0,
        scheduledDeactivationAt: DEADLINE,
        completedAt: DEADLINE,
      }),
      DEADLINE,
    );
    expect(targets(items, "DEACTIVATION_COMPLETED")).toEqual(adminUserIds);
    expect(targets(items, "DEACTIVATION_COMPLETED")).not.toContain("chief-1");
    expect(items.some((i) => i.type === "DEACTIVATION_REMINDER")).toBe(false);
  });

  describe("reminders", () => {
    const approved = request({
      status: "APPROVED",
      approvedAt: T0,
      scheduledDeactivationAt: DEADLINE,
    });
    const reminders = (now: Date) =>
      plan(approved, now).filter((i) => i.type === "DEACTIVATION_REMINDER");

    it("sends none before T-12h", () => {
      expect(reminders(new Date(DEADLINE.getTime() - 13 * HOUR))).toHaveLength(0);
    });

    it("sends the T-12h reminder to Chief and admins once due", () => {
      const items = reminders(new Date(DEADLINE.getTime() - 12 * HOUR));
      expect(items.map((i) => i.userId).sort()).toEqual(
        ["admin-1", "admin-2", "chief-1"].sort(),
      );
    });

    it("adds the T-1h reminder later, with its own dedupe keys", () => {
      const items = reminders(new Date(DEADLINE.getTime() - 30 * 60 * 1000));
      expect(items).toHaveLength(6);
      expect(new Set(items.map((i) => i.dedupeKey)).size).toBe(6);
    });

    it("still sends a missed reminder late, but never at or after the deadline", () => {
      expect(reminders(new Date(DEADLINE.getTime() - 5 * 60 * 1000))).toHaveLength(6);
      expect(reminders(DEADLINE)).toHaveLength(0);
    });

    it("sends no reminders for a cancelled request", () => {
      const cancelled = request({
        status: "CANCELLED",
        approvedAt: T0,
        scheduledDeactivationAt: DEADLINE,
        cancelledAt: new Date(DEADLINE.getTime() - 2 * HOUR),
      });
      expect(
        plan(cancelled, new Date(DEADLINE.getTime() - 30 * 60 * 1000)).some(
          (i) => i.type === "DEACTIVATION_REMINDER",
        ),
      ).toBe(false);
    });
  });

  it("is deterministic: same input gives identical dedupe keys", () => {
    const req = request();
    expect(plan(req).map((i) => i.dedupeKey)).toEqual(
      plan(req).map((i) => i.dedupeKey),
    );
  });

  it("does not duplicate a user who is both Chief and admin", () => {
    const items = planDeactivationNotifications({
      request: request({
        status: "APPROVED",
        approvedAt: T0,
        scheduledDeactivationAt: DEADLINE,
      }),
      village,
      adminUserIds: ["u1"],
      chiefUserIds: ["u1"],
      now: new Date(DEADLINE.getTime() - 6 * HOUR),
      reminderOffsetsMs: [12 * HOUR],
    });
    const keys = items.map((i) => i.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
