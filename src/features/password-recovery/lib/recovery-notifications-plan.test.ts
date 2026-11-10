import { describe, expect, it } from "vitest";

import {
  planRecoveryNotifications,
  recoveryDedupeKey,
  type PlanPerson,
  type RecoveryPlanRequest,
} from "./recovery-notifications-plan";

const at = (iso: string) => new Date(iso);

const chief: PlanPerson = { id: "chief-1", name: "U Chief", role: "CHIEF" };
const admin: PlanPerson = { id: "admin-1", name: "Admin", role: "SYSTEM_ADMIN" };

function request(
  overrides: Partial<RecoveryPlanRequest> = {},
): RecoveryPlanRequest {
  return {
    id: "req-1",
    villageId: "village-1",
    status: "PENDING",
    requestExpiresAt: at("2026-11-11T10:00:00.000Z"),
    rejectionNote: null,
    rejectedAt: null,
    completedAt: null,
    target: { id: "member-1", name: "Daw Member" },
    issuedBy: null,
    rejectedBy: null,
    ...overrides,
  };
}

const completed = (overrides: Partial<RecoveryPlanRequest> = {}) =>
  request({
    status: "COMPLETED",
    completedAt: at("2026-11-05T08:30:00.000Z"),
    issuedBy: chief,
    ...overrides,
  });

describe("request filed", () => {
  it("notifies each approver once, with names and times only", () => {
    const plan = planRecoveryNotifications({
      request: request(),
      approverUserIds: ["chief-1", "chief-2"],
    });

    expect(plan).toEqual([
      {
        userId: "chief-1",
        villageId: "village-1",
        recoveryRequestId: "req-1",
        type: "RECOVERY_REQUESTED",
        dedupeKey: "recovery:req-1:requested:chief-1",
        params: {
          targetName: "Daw Member",
          requestExpiresAt: "2026-11-11T10:00:00.000Z",
        },
      },
      {
        userId: "chief-2",
        villageId: "village-1",
        recoveryRequestId: "req-1",
        type: "RECOVERY_REQUESTED",
        dedupeKey: "recovery:req-1:requested:chief-2",
        params: {
          targetName: "Daw Member",
          requestExpiresAt: "2026-11-11T10:00:00.000Z",
        },
      },
    ]);
  });

  it("lists a duplicated approver only once", () => {
    const plan = planRecoveryNotifications({
      request: request(),
      approverUserIds: ["chief-1", "chief-1", "chief-1"],
    });

    expect(plan).toHaveLength(1);
  });

  it("never tells the account owner to approve their own request", () => {
    const plan = planRecoveryNotifications({
      request: request(),
      approverUserIds: ["member-1", "chief-1"],
    });

    expect(plan.map((n) => n.userId)).toEqual(["chief-1"]);
  });

  it("plans nothing when there are no approvers", () => {
    expect(
      planRecoveryNotifications({ request: request(), approverUserIds: [] }),
    ).toEqual([]);
  });

  it("keeps a null village for a System Admin's request", () => {
    const plan = planRecoveryNotifications({
      request: request({ villageId: null }),
      approverUserIds: ["admin-2"],
    });

    expect(plan[0].villageId).toBe(null);
  });

  it("is not planned once the request is no longer waiting", () => {
    for (const status of ["CODE_ISSUED", "EXPIRED", "REVOKED"]) {
      expect(
        planRecoveryNotifications({
          request: request({ status }),
          approverUserIds: ["chief-1"],
        }),
      ).toEqual([]);
    }
  });
});

describe("request rejected", () => {
  it("tells the member, with the note and who rejected", () => {
    const plan = planRecoveryNotifications({
      request: request({
        status: "REJECTED",
        rejectedAt: at("2026-11-04T12:00:00.000Z"),
        rejectionNote: "Please visit me in person",
        rejectedBy: chief,
      }),
      approverUserIds: ["chief-1"],
    });

    expect(plan).toEqual([
      {
        userId: "member-1",
        villageId: "village-1",
        recoveryRequestId: "req-1",
        type: "RECOVERY_REJECTED",
        dedupeKey: "recovery:req-1:rejected:member-1",
        params: {
          rejectedAt: "2026-11-04T12:00:00.000Z",
          rejectionNote: "Please visit me in person",
          rejectedByName: "U Chief",
          rejectedByRole: "CHIEF",
        },
      },
    ]);
  });

  it("uses an empty note when none was given", () => {
    const plan = planRecoveryNotifications({
      request: request({
        status: "REJECTED",
        rejectedAt: at("2026-11-04T12:00:00.000Z"),
        rejectedBy: admin,
      }),
      approverUserIds: [],
    });

    expect(plan[0].params.rejectionNote).toBe("");
    expect(plan[0].params.rejectedByRole).toBe("SYSTEM_ADMIN");
  });
});

describe("password reset completed", () => {
  it("tells the member their password changed, when, and who issued the code", () => {
    const plan = planRecoveryNotifications({
      request: completed(),
      approverUserIds: [],
    });
    const notice = plan.find((n) => n.type === "RECOVERY_PASSWORD_CHANGED");

    expect(notice).toEqual({
      userId: "member-1",
      villageId: "village-1",
      recoveryRequestId: "req-1",
      type: "RECOVERY_PASSWORD_CHANGED",
      dedupeKey: "recovery:req-1:password-changed:member-1",
      params: {
        completedAt: "2026-11-05T08:30:00.000Z",
        issuedByName: "U Chief",
        issuedByRole: "CHIEF",
      },
    });
  });

  it("tells the issuer the code was used", () => {
    const plan = planRecoveryNotifications({
      request: completed(),
      approverUserIds: [],
    });
    const notice = plan.find((n) => n.type === "RECOVERY_RESET_COMPLETED");

    expect(notice).toEqual({
      userId: "chief-1",
      villageId: "village-1",
      recoveryRequestId: "req-1",
      type: "RECOVERY_RESET_COMPLETED",
      dedupeKey: "recovery:req-1:reset-completed:chief-1",
      params: {
        targetName: "Daw Member",
        completedAt: "2026-11-05T08:30:00.000Z",
      },
    });
  });

  it("names a System Admin as the issuer when an Admin issued the code", () => {
    const plan = planRecoveryNotifications({
      request: completed({ issuedBy: admin }),
      approverUserIds: [],
    });

    expect(plan.map((n) => [n.type, n.userId])).toEqual([
      ["RECOVERY_PASSWORD_CHANGED", "member-1"],
      ["RECOVERY_RESET_COMPLETED", "admin-1"],
    ]);
    expect(plan[0].params.issuedByRole).toBe("SYSTEM_ADMIN");
  });

  it("still tells the member if the issuer is somehow unknown", () => {
    const plan = planRecoveryNotifications({
      request: completed({ issuedBy: null }),
      approverUserIds: [],
    });

    expect(plan.map((n) => n.type)).toEqual(["RECOVERY_PASSWORD_CHANGED"]);
    expect(plan[0].params.issuedByName).toBe("");
  });
});

describe("safety of the plan", () => {
  const SAFE_KEYS = new Set([
    "targetName",
    "requestExpiresAt",
    "rejectedAt",
    "rejectionNote",
    "rejectedByName",
    "rejectedByRole",
    "completedAt",
    "issuedByName",
    "issuedByRole",
  ]);

  const everything = [
    ...planRecoveryNotifications({
      request: request(),
      approverUserIds: ["chief-1", "admin-1"],
    }),
    ...planRecoveryNotifications({
      request: request({
        status: "REJECTED",
        rejectedAt: at("2026-11-04T12:00:00.000Z"),
        rejectedBy: chief,
        rejectionNote: "note",
      }),
      approverUserIds: [],
    }),
    ...planRecoveryNotifications({
      request: completed(),
      approverUserIds: [],
    }),
  ];

  it("only ever carries names, times, a note and roles in params", () => {
    expect(everything.length > 0).toBe(true);

    for (const notification of everything) {
      for (const key of Object.keys(notification.params)) {
        expect(SAFE_KEYS.has(key)).toBe(true);
      }
    }
  });

  it("uses dedupe keys that are unique across the whole plan", () => {
    const keys = everything.map((n) => n.dedupeKey);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("builds dedupe keys as recovery:<request>:<event>:<user>", () => {
    expect(recoveryDedupeKey("r", "requested", "u")).toBe(
      "recovery:r:requested:u",
    );
  });

  it("never plans a notification for a request in no event state", () => {
    for (const status of ["CODE_ISSUED", "EXPIRED", "REVOKED"]) {
      expect(
        planRecoveryNotifications({
          request: request({ status }),
          approverUserIds: [],
        }),
      ).toEqual([]);
    }
  });
});
