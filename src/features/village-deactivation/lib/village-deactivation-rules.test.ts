import { describe, expect, it } from "vitest";

import {
  DEACTIVATION_COUNTDOWN_MS,
  VILLAGE_READ_ONLY_CODE,
  canTransitionRequest,
  computeCooldownEndsAt,
  computeScheduledDeactivationAt,
  dueReminderOffsetsMs,
  evaluateApproval,
  evaluateCancellation,
  evaluateCompletion,
  evaluateVillageWrite,
  evaluateNewRequest,
  evaluateRejection,
  isReadOnlyStatus,
  isUnresolved,
  withReadOnlyError,
  type DeactivationAction,
  type DeactivationRequestStatus,
} from "./village-deactivation-rules";

const HOUR = 60 * 60 * 1000;
const STATUSES: DeactivationRequestStatus[] = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "COMPLETED",
];

const EXPECTED: Record<DeactivationAction, DeactivationRequestStatus[]> = {
  approve: ["PENDING"],
  reject: ["PENDING"],
  cancel: ["APPROVED"],
  complete: ["APPROVED"],
};

const approvedAt = new Date("2026-10-28T10:00:00.000Z");
const deadline = new Date("2026-10-29T10:00:00.000Z");

describe("canTransitionRequest", () => {
  for (const action of Object.keys(EXPECTED) as DeactivationAction[]) {
    for (const status of STATUSES) {
      const allowed = EXPECTED[action].includes(status);

      it(`${action} from ${status} is ${allowed ? "allowed" : "blocked"}`, () => {
        expect(canTransitionRequest(action, status)).toBe(allowed);
      });
    }
  }

  it("never leaves a terminal status", () => {
    for (const status of ["REJECTED", "CANCELLED", "COMPLETED"] as const) {
      for (const action of Object.keys(EXPECTED) as DeactivationAction[]) {
        expect(canTransitionRequest(action, status)).toBe(false);
      }
    }
  });
});

describe("read-only and unresolved status", () => {
  it("only APPROVED is read-only; PENDING restricts nothing", () => {
    expect(STATUSES.filter(isReadOnlyStatus)).toEqual(["APPROVED"]);
  });

  it("PENDING and APPROVED are unresolved", () => {
    expect(STATUSES.filter(isUnresolved)).toEqual(["PENDING", "APPROVED"]);
  });
});

describe("timestamps", () => {
  it("the countdown is exactly 24 hours from approval", () => {
    expect(DEACTIVATION_COUNTDOWN_MS).toBe(24 * HOUR);
    expect(computeScheduledDeactivationAt(approvedAt).toISOString()).toBe(
      "2026-10-29T10:00:00.000Z",
    );
  });

  it("does not mutate its input", () => {
    const input = new Date(approvedAt);
    computeScheduledDeactivationAt(input);
    expect(input.getTime()).toBe(approvedAt.getTime());
  });

  it("the cooldown is rejectedAt plus the configured duration", () => {
    expect(computeCooldownEndsAt(approvedAt, 24 * HOUR).toISOString()).toBe(
      "2026-10-29T10:00:00.000Z",
    );
    expect(computeCooldownEndsAt(approvedAt, 2 * HOUR).toISOString()).toBe(
      "2026-10-28T12:00:00.000Z",
    );
  });
});

describe("evaluateNewRequest", () => {
  const now = new Date("2026-10-28T12:00:00.000Z");
  const base = {
    villageStatus: "ACTIVE" as const,
    existingStatuses: [] as DeactivationRequestStatus[],
    latestCooldownEndsAt: null,
    now,
  };

  it("allows a first request on an ACTIVE village", () => {
    expect(evaluateNewRequest(base)).toEqual({ ok: true });
  });

  it("refuses a SUSPENDED or DEACTIVATED village", () => {
    for (const villageStatus of ["SUSPENDED", "DEACTIVATED"] as const) {
      expect(evaluateNewRequest({ ...base, villageStatus })).toEqual({
        ok: false,
        reason: "VILLAGE_NOT_ACTIVE",
      });
    }
  });

  it("refuses while a PENDING or APPROVED request exists", () => {
    for (const status of ["PENDING", "APPROVED"] as const) {
      expect(
        evaluateNewRequest({ ...base, existingStatuses: ["CANCELLED", status] }),
      ).toEqual({ ok: false, reason: "UNRESOLVED_REQUEST_EXISTS" });
    }
  });

  it("allows a new request after CANCELLED or COMPLETED history", () => {
    expect(
      evaluateNewRequest({
        ...base,
        existingStatuses: ["CANCELLED", "REJECTED"],
      }),
    ).toEqual({ ok: true });
  });

  it("blocks resubmission until the cooldown has elapsed, then allows it", () => {
    const cooldownEndsAt = new Date("2026-10-29T10:00:00.000Z");
    const rejected = {
      ...base,
      existingStatuses: ["REJECTED" as const],
      latestCooldownEndsAt: cooldownEndsAt,
    };

    expect(evaluateNewRequest(rejected)).toEqual({
      ok: false,
      reason: "COOLDOWN_ACTIVE",
      cooldownEndsAt,
    });
    expect(
      evaluateNewRequest({
        ...rejected,
        now: new Date(cooldownEndsAt.getTime() - 1),
      }).ok,
    ).toBe(false);
    // The cooldown end is the first instant the Chief may submit again.
    expect(evaluateNewRequest({ ...rejected, now: cooldownEndsAt })).toEqual({
      ok: true,
    });
  });

  it("reports an unresolved request before the cooldown", () => {
    expect(
      evaluateNewRequest({
        ...base,
        existingStatuses: ["PENDING"],
        latestCooldownEndsAt: new Date("2026-10-30T00:00:00.000Z"),
      }),
    ).toEqual({ ok: false, reason: "UNRESOLVED_REQUEST_EXISTS" });
  });
});

describe("evaluateApproval", () => {
  it("approves a PENDING request on an ACTIVE village", () => {
    expect(
      evaluateApproval({ status: "PENDING", villageStatus: "ACTIVE" }),
    ).toEqual({ ok: true });
  });

  it("refuses a SUSPENDED village until it is reactivated", () => {
    expect(
      evaluateApproval({ status: "PENDING", villageStatus: "SUSPENDED" }),
    ).toEqual({ ok: false, reason: "VILLAGE_NOT_ACTIVE" });
  });

  it("refuses a request that is not PENDING", () => {
    for (const status of STATUSES.filter((s) => s !== "PENDING")) {
      expect(evaluateApproval({ status, villageStatus: "ACTIVE" })).toEqual({
        ok: false,
        reason: "NOT_PENDING",
      });
    }
  });
});

describe("evaluateRejection", () => {
  it("rejects only a PENDING request", () => {
    for (const status of STATUSES) {
      expect(evaluateRejection({ status }).ok).toBe(status === "PENDING");
    }
  });
});

describe("evaluateCancellation", () => {
  const approved = { status: "APPROVED" as const, scheduledDeactivationAt: deadline };

  it("allows cancellation strictly before the deadline", () => {
    expect(
      evaluateCancellation({ ...approved, now: new Date(deadline.getTime() - 1) }),
    ).toEqual({ ok: true });
    expect(evaluateCancellation({ ...approved, now: approvedAt })).toEqual({
      ok: true,
    });
  });

  it("refuses at the deadline and after it, even if the worker has not run", () => {
    for (const now of [deadline, new Date(deadline.getTime() + 1)]) {
      expect(evaluateCancellation({ ...approved, now })).toEqual({
        ok: false,
        reason: "DEADLINE_REACHED",
      });
    }
  });

  it("refuses anything that is not APPROVED", () => {
    for (const status of STATUSES.filter((s) => s !== "APPROVED")) {
      expect(
        evaluateCancellation({ ...approved, status, now: approvedAt }),
      ).toEqual({ ok: false, reason: "NOT_APPROVED" });
    }
  });

  it("refuses an APPROVED row that has no deadline", () => {
    expect(
      evaluateCancellation({
        status: "APPROVED",
        scheduledDeactivationAt: null,
        now: approvedAt,
      }),
    ).toEqual({ ok: false, reason: "MISSING_DEADLINE" });
  });
});

describe("evaluateCompletion", () => {
  const approved = {
    status: "APPROVED" as const,
    scheduledDeactivationAt: deadline,
    villageStatus: "ACTIVE" as const,
  };

  it("is not due before the deadline", () => {
    expect(
      evaluateCompletion({ ...approved, now: new Date(deadline.getTime() - 1) }),
    ).toEqual({ ok: false, reason: "NOT_DUE" });
  });

  it("is due at the deadline and long after it (missed runs)", () => {
    for (const now of [deadline, new Date(deadline.getTime() + 30 * 24 * HOUR)]) {
      expect(evaluateCompletion({ ...approved, now })).toEqual({ ok: true });
    }
  });

  it("completes a SUSPENDED village but not an already DEACTIVATED one", () => {
    expect(
      evaluateCompletion({ ...approved, villageStatus: "SUSPENDED", now: deadline }),
    ).toEqual({ ok: true });
    expect(
      evaluateCompletion({
        ...approved,
        villageStatus: "DEACTIVATED",
        now: deadline,
      }),
    ).toEqual({ ok: false, reason: "VILLAGE_ALREADY_DEACTIVATED" });
  });

  it("is idempotent: a COMPLETED, CANCELLED or PENDING request is refused", () => {
    for (const status of STATUSES.filter((s) => s !== "APPROVED")) {
      expect(evaluateCompletion({ ...approved, status, now: deadline })).toEqual({
        ok: false,
        reason: "NOT_APPROVED",
      });
    }
  });

  it("refuses an APPROVED row that has no deadline", () => {
    expect(
      evaluateCompletion({ ...approved, scheduledDeactivationAt: null, now: deadline }),
    ).toEqual({ ok: false, reason: "MISSING_DEADLINE" });
  });
});

describe("cancel and complete never both succeed", () => {
  it("exactly one is possible at every instant around the deadline", () => {
    const base = {
      status: "APPROVED" as const,
      scheduledDeactivationAt: deadline,
      villageStatus: "ACTIVE" as const,
    };

    for (const offset of [-HOUR, -1000, -1, 0, 1, 1000, HOUR]) {
      const now = new Date(deadline.getTime() + offset);
      const cancel = evaluateCancellation({ ...base, now }).ok;
      const complete = evaluateCompletion({ ...base, now }).ok;

      expect(cancel !== complete).toBe(true);
    }
  });
});

describe("dueReminderOffsetsMs", () => {
  const offsetsMs = [12 * HOUR, 1 * HOUR];
  const at = (hoursBeforeDeadline: number) =>
    new Date(deadline.getTime() - hoursBeforeDeadline * HOUR);

  it("has nothing due right after approval", () => {
    expect(
      dueReminderOffsetsMs({ scheduledDeactivationAt: deadline, offsetsMs, now: approvedAt }),
    ).toEqual([]);
  });

  it("T-12h is due once 12 hours remain, T-1h once 1 hour remains", () => {
    expect(
      dueReminderOffsetsMs({ scheduledDeactivationAt: deadline, offsetsMs, now: at(12) }),
    ).toEqual([12 * HOUR]);
    expect(
      dueReminderOffsetsMs({ scheduledDeactivationAt: deadline, offsetsMs, now: at(1) }),
    ).toEqual([12 * HOUR, 1 * HOUR]);
  });

  it("a missed T-12h is still due later, until the deadline", () => {
    expect(
      dueReminderOffsetsMs({ scheduledDeactivationAt: deadline, offsetsMs, now: at(5) }),
    ).toEqual([12 * HOUR]);
  });

  it("nothing is due at or after the deadline", () => {
    expect(
      dueReminderOffsetsMs({ scheduledDeactivationAt: deadline, offsetsMs, now: deadline }),
    ).toEqual([]);
  });
});

describe("evaluateVillageWrite", () => {
  it("allows writes on an ACTIVE village with no approved request", () => {
    expect(
      evaluateVillageWrite({ villageStatus: "ACTIVE", hasApprovedRequest: false }),
    ).toEqual({ ok: true });
  });

  it("blocks an ACTIVE village with an APPROVED request as read-only", () => {
    expect(
      evaluateVillageWrite({ villageStatus: "ACTIVE", hasApprovedRequest: true }),
    ).toEqual({ ok: false, reason: "VILLAGE_READ_ONLY" });
  });

  it("reports an inactive or missing village as inactive, never read-only", () => {
    for (const villageStatus of ["SUSPENDED", "DEACTIVATED", null, "unknown"]) {
      for (const hasApprovedRequest of [false, true]) {
        expect(evaluateVillageWrite({ villageStatus, hasApprovedRequest })).toEqual({
          ok: false,
          reason: "VILLAGE_INACTIVE",
        });
      }
    }
  });

  it("uses the same code string the actions return", () => {
    expect(VILLAGE_READ_ONLY_CODE).toBe("VILLAGE_READ_ONLY");
  });
});

describe("withReadOnlyError", () => {
  it("adds the error parameter to a path", () => {
    expect(withReadOnlyError("/village/funds/f1")).toBe(
      "/village/funds/f1?error=VILLAGE_READ_ONLY",
    );
  });

  it("appends to an existing query string", () => {
    expect(withReadOnlyError("/village/houses?x=1")).toBe(
      "/village/houses?x=1&error=VILLAGE_READ_ONLY",
    );
  });
});
