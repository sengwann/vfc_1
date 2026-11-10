import { describe, expect, it } from "vitest";

import {
  RECOVERY_CODE_TTL_MS,
  RECOVERY_MAX_FAILED_REDEEM_ATTEMPTS,
  RECOVERY_NOTE_MAX_LENGTH,
  RECOVERY_REQUEST_TTL_MS,
} from "./recovery-config";
import {
  canTransitionRecovery,
  computeCodeExpiresAt,
  computeRequestExpiresAt,
  evaluateFailedRedeem,
  evaluateIssue,
  evaluateNewRequest,
  evaluateRedeem,
  evaluateReject,
  evaluateTarget,
  evaluateWithdraw,
  isActiveRecoveryStatus,
  isExpiryDue,
  isTerminalRecoveryStatus,
  normalizeRecoveryNote,
  type RecoveryAction,
  type RecoveryStatus,
  type RecoveryTarget,
  type StateFields,
} from "./recovery-rules";

const HOUR = 60 * 60 * 1000;
const ALL_STATUSES: RecoveryStatus[] = [
  "PENDING",
  "CODE_ISSUED",
  "COMPLETED",
  "REJECTED",
  "EXPIRED",
  "REVOKED",
];

const now = new Date("2026-11-04T10:00:00.000Z");
const later = new Date(now.getTime() + HOUR);
const earlier = new Date(now.getTime() - HOUR);

const villager: RecoveryTarget = {
  role: "VILLAGER",
  membershipStatus: "ACTIVE",
  villageStatus: "ACTIVE",
  otherSystemAdminCount: 0,
};

function request(overrides: Partial<StateFields> = {}): StateFields {
  return {
    status: "PENDING",
    requestExpiresAt: later,
    codeExpiresAt: null,
    targetUserId: "target",
    ...overrides,
  };
}

function issued(overrides: Partial<StateFields> = {}): StateFields {
  return request({ status: "CODE_ISSUED", codeExpiresAt: later, ...overrides });
}

describe("transition table", () => {
  const EXPECTED: Record<RecoveryAction, RecoveryStatus[]> = {
    issue: ["PENDING", "CODE_ISSUED"],
    reject: ["PENDING"],
    withdraw: ["CODE_ISSUED"],
    redeem: ["CODE_ISSUED"],
    expire: ["PENDING", "CODE_ISSUED"],
    revokeBySystem: ["PENDING", "CODE_ISSUED"],
  };

  for (const [action, allowed] of Object.entries(EXPECTED)) {
    it(`${action} is allowed from exactly ${allowed.join(", ")}`, () => {
      const actual = ALL_STATUSES.filter((status) =>
        canTransitionRecovery(action as RecoveryAction, status),
      );

      expect(actual).toEqual(allowed);
    });
  }

  it("never leaves a final state", () => {
    for (const status of ["COMPLETED", "REJECTED", "EXPIRED", "REVOKED"] as const) {
      for (const action of Object.keys(EXPECTED) as RecoveryAction[]) {
        expect(canTransitionRecovery(action, status)).toBe(false);
      }
    }
  });

  it("splits states into active and final", () => {
    expect(ALL_STATUSES.filter(isActiveRecoveryStatus)).toEqual([
      "PENDING",
      "CODE_ISSUED",
    ]);
    expect(ALL_STATUSES.filter(isTerminalRecoveryStatus)).toEqual([
      "COMPLETED",
      "REJECTED",
      "EXPIRED",
      "REVOKED",
    ]);
  });
});

describe("time", () => {
  it("uses the 7 day request and 72 hour code lifetimes", () => {
    expect(RECOVERY_REQUEST_TTL_MS).toBe(7 * 24 * HOUR);
    expect(RECOVERY_CODE_TTL_MS).toBe(72 * HOUR);
    expect(computeRequestExpiresAt(now).getTime() - now.getTime()).toBe(
      7 * 24 * HOUR,
    );
    expect(computeCodeExpiresAt(now).getTime() - now.getTime()).toBe(72 * HOUR);
  });

  it("expires a PENDING request exactly at its expiry instant, not before", () => {
    const pending = request({ requestExpiresAt: now });

    expect(isExpiryDue(pending, new Date(now.getTime() - 1))).toBe(false);
    expect(isExpiryDue(pending, now)).toBe(true);
    expect(isExpiryDue(pending, new Date(now.getTime() + 1))).toBe(true);
  });

  it("expires a CODE_ISSUED request at its code expiry, not its request expiry", () => {
    const live = issued({ requestExpiresAt: earlier, codeExpiresAt: later });
    const dead = issued({ requestExpiresAt: later, codeExpiresAt: now });

    expect(isExpiryDue(live, now)).toBe(false);
    expect(isExpiryDue(dead, now)).toBe(true);
  });

  it("treats a CODE_ISSUED request with no code expiry as expired (never usable)", () => {
    expect(isExpiryDue(issued({ codeExpiresAt: null }), now)).toBe(true);
  });

  it("never expires a final state", () => {
    for (const status of ["COMPLETED", "REJECTED", "EXPIRED", "REVOKED"] as const) {
      expect(
        isExpiryDue(request({ status, requestExpiresAt: earlier }), now),
      ).toBe(false);
    }
  });
});

describe("target eligibility", () => {
  it("accepts an ACTIVE member of an ACTIVE village", () => {
    expect(evaluateNewRequest(villager)).toEqual({ ok: true });
  });

  it("accepts an ACTIVE Chief the same way", () => {
    expect(evaluateNewRequest({ ...villager, role: "CHIEF" })).toEqual({
      ok: true,
    });
  });

  it("refuses PENDING, REJECTED, REMOVED and missing memberships", () => {
    for (const membershipStatus of ["PENDING", "REJECTED", "REMOVED", null] as const) {
      expect(evaluateNewRequest({ ...villager, membershipStatus })).toEqual({
        ok: false,
        reason: "NOT_ELIGIBLE",
      });
    }
  });

  it("refuses a request from a SUSPENDED or DEACTIVATED village", () => {
    for (const villageStatus of ["SUSPENDED", "DEACTIVATED", null] as const) {
      expect(evaluateNewRequest({ ...villager, villageStatus })).toEqual({
        ok: false,
        reason: "VILLAGE_NOT_ACTIVE",
      });
    }
  });

  it("lets a System Admin recover only while another System Admin exists", () => {
    const admin: RecoveryTarget = {
      role: "SYSTEM_ADMIN",
      membershipStatus: null,
      villageStatus: null,
      otherSystemAdminCount: 0,
    };

    expect(evaluateNewRequest(admin)).toEqual({
      ok: false,
      reason: "NOT_ELIGIBLE",
    });
    expect(evaluateNewRequest({ ...admin, otherSystemAdminCount: 1 })).toEqual({
      ok: true,
    });
  });

  it("can skip the village check for a recovery that already has a code", () => {
    expect(
      evaluateTarget(
        { ...villager, villageStatus: "SUSPENDED" },
        { requireActiveVillage: false },
      ),
    ).toEqual({ ok: true });
    expect(
      evaluateTarget(
        { ...villager, membershipStatus: "REMOVED", villageStatus: "SUSPENDED" },
        { requireActiveVillage: false },
      ),
    ).toEqual({ ok: false, reason: "NOT_ELIGIBLE" });
  });
});

describe("evaluateIssue", () => {
  const base = { actorUserId: "chief", target: villager, now };

  it("issues for a PENDING request", () => {
    expect(evaluateIssue({ ...base, request: request() })).toEqual({ ok: true });
  });

  it("re-issues while the current code is still live", () => {
    expect(evaluateIssue({ ...base, request: issued() })).toEqual({ ok: true });
  });

  it("refuses every final state", () => {
    for (const status of ["COMPLETED", "REJECTED", "EXPIRED", "REVOKED"] as const) {
      expect(evaluateIssue({ ...base, request: request({ status }) })).toEqual({
        ok: false,
        reason: "WRONG_STATE",
      });
    }
  });

  it("refuses an expired PENDING request and an expired code", () => {
    expect(
      evaluateIssue({
        ...base,
        request: request({ requestExpiresAt: now }),
      }),
    ).toEqual({ ok: false, reason: "EXPIRED" });
    expect(
      evaluateIssue({ ...base, request: issued({ codeExpiresAt: earlier }) }),
    ).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("never lets an approver recover their own account", () => {
    expect(
      evaluateIssue({ ...base, actorUserId: "target", request: request() }),
    ).toEqual({ ok: false, reason: "SELF_ACTION" });
  });

  it("blocks new codes once the village is suspended or deactivated", () => {
    for (const villageStatus of ["SUSPENDED", "DEACTIVATED"] as const) {
      expect(
        evaluateIssue({
          ...base,
          request: request(),
          target: { ...villager, villageStatus },
        }),
      ).toEqual({ ok: false, reason: "VILLAGE_NOT_ACTIVE" });
    }
  });

  it("blocks a code for an account that is no longer an ACTIVE member", () => {
    expect(
      evaluateIssue({
        ...base,
        request: request(),
        target: { ...villager, membershipStatus: "REMOVED" },
      }),
    ).toEqual({ ok: false, reason: "NOT_ELIGIBLE" });
  });
});

describe("evaluateReject and evaluateWithdraw", () => {
  it("rejects only a PENDING request", () => {
    expect(
      evaluateReject({ request: request(), actorUserId: "chief", now }),
    ).toEqual({ ok: true });

    for (const status of ["CODE_ISSUED", "COMPLETED", "REJECTED", "EXPIRED", "REVOKED"] as const) {
      expect(
        evaluateReject({
          request: request({ status, codeExpiresAt: later }),
          actorUserId: "chief",
          now,
        }),
      ).toEqual({ ok: false, reason: "WRONG_STATE" });
    }
  });

  it("withdraws only a live CODE_ISSUED request", () => {
    expect(
      evaluateWithdraw({ request: issued(), actorUserId: "chief", now }),
    ).toEqual({ ok: true });
    expect(
      evaluateWithdraw({ request: request(), actorUserId: "chief", now }),
    ).toEqual({ ok: false, reason: "WRONG_STATE" });
    expect(
      evaluateWithdraw({
        request: issued({ codeExpiresAt: now }),
        actorUserId: "chief",
        now,
      }),
    ).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("refuses an expired request", () => {
    expect(
      evaluateReject({
        request: request({ requestExpiresAt: earlier }),
        actorUserId: "chief",
        now,
      }),
    ).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("refuses to act on one's own request", () => {
    expect(
      evaluateReject({ request: request(), actorUserId: "target", now }),
    ).toEqual({ ok: false, reason: "SELF_ACTION" });
    expect(
      evaluateWithdraw({ request: issued(), actorUserId: "target", now }),
    ).toEqual({ ok: false, reason: "SELF_ACTION" });
  });

  it("stays possible while the village is not ACTIVE (not village-gated)", () => {
    // These evaluators take no village status at all: a Chief or Admin can
    // always close a request or pull back a code.
    expect(
      evaluateReject({ request: request(), actorUserId: "admin", now }).ok,
    ).toBe(true);
  });
});

describe("evaluateRedeem", () => {
  it("completes a live code", () => {
    expect(evaluateRedeem({ request: issued(), target: villager, now })).toEqual(
      { ok: true },
    );
  });

  it("refuses a PENDING request (no code yet) and every final state", () => {
    for (const status of ["PENDING", "COMPLETED", "REJECTED", "EXPIRED", "REVOKED"] as const) {
      expect(
        evaluateRedeem({
          request: request({ status, codeExpiresAt: later }),
          target: villager,
          now,
        }),
      ).toEqual({ ok: false, reason: "WRONG_STATE" });
    }
  });

  it("refuses at the expiry instant", () => {
    expect(
      evaluateRedeem({
        request: issued({ codeExpiresAt: now }),
        target: villager,
        now,
      }),
    ).toEqual({ ok: false, reason: "EXPIRED" });
    expect(
      evaluateRedeem({
        request: issued({ codeExpiresAt: new Date(now.getTime() + 1) }),
        target: villager,
        now,
      }),
    ).toEqual({ ok: true });
  });

  it("still completes after the village was suspended (issuing is blocked, completing is not)", () => {
    for (const villageStatus of ["SUSPENDED", "DEACTIVATED"] as const) {
      expect(
        evaluateRedeem({
          request: issued(),
          target: { ...villager, villageStatus },
          now,
        }),
      ).toEqual({ ok: true });
    }
  });

  it("refuses when the account is no longer an ACTIVE member", () => {
    expect(
      evaluateRedeem({
        request: issued(),
        target: { ...villager, membershipStatus: "REMOVED" },
        now,
      }),
    ).toEqual({ ok: false, reason: "NOT_ELIGIBLE" });
  });
});

describe("wrong codes", () => {
  it("revokes on the last allowed wrong guess", () => {
    expect(RECOVERY_MAX_FAILED_REDEEM_ATTEMPTS).toBe(5);

    for (let before = 0; before < 4; before += 1) {
      expect(evaluateFailedRedeem(before)).toEqual({
        failedAttempts: before + 1,
        revoke: false,
      });
    }

    expect(evaluateFailedRedeem(4)).toEqual({ failedAttempts: 5, revoke: true });
    expect(evaluateFailedRedeem(5)).toEqual({ failedAttempts: 6, revoke: true });
  });
});

describe("normalizeRecoveryNote", () => {
  const optional = { required: false };
  const required = { required: true };

  it("treats blank as no note when optional, and as missing when required", () => {
    for (const blank of [undefined, null, "", "   ", "\t \n"]) {
      expect(normalizeRecoveryNote(blank, optional)).toEqual({
        ok: true,
        note: null,
      });
      expect(normalizeRecoveryNote(blank, required)).toEqual({
        ok: false,
        reason: "REQUIRED",
      });
    }
  });

  it("trims and keeps a normal note", () => {
    expect(normalizeRecoveryNote("  Please call me  ", optional)).toEqual({
      ok: true,
      note: "Please call me",
    });
  });

  it("refuses anything that is not text", () => {
    for (const value of [1, true, {}, [], ["a"]]) {
      expect(normalizeRecoveryNote(value, optional)).toEqual({
        ok: false,
        reason: "NOT_TEXT",
      });
    }
  });

  it("accepts exactly the maximum and refuses one more", () => {
    expect(RECOVERY_NOTE_MAX_LENGTH).toBe(200);
    expect(
      normalizeRecoveryNote("x".repeat(200), optional),
    ).toEqual({ ok: true, note: "x".repeat(200) });
    expect(normalizeRecoveryNote("x".repeat(201), optional)).toEqual({
      ok: false,
      reason: "TOO_LONG",
    });
  });

  it("counts characters like the database: an emoji is one, not two", () => {
    // 200 emoji are 400 UTF-16 units but 200 characters.
    expect(normalizeRecoveryNote("😀".repeat(200), optional).ok).toBe(true);
    expect(normalizeRecoveryNote("😀".repeat(201), optional)).toEqual({
      ok: false,
      reason: "TOO_LONG",
    });
  });

  it("accepts Burmese text", () => {
    const note = "မင်္ဂလာပါ ကျေးဇူးတင်ပါတယ်";
    expect(normalizeRecoveryNote(note, optional)).toEqual({ ok: true, note });
  });

  it("refuses control characters, including line breaks inside the note", () => {
    for (const bad of ["a\nb", "a\u0000b", "a\u001Fb", "a\u007Fb", "a\u0085b"]) {
      expect(normalizeRecoveryNote(bad, optional)).toEqual({
        ok: false,
        reason: "INVALID_CHARACTERS",
      });
    }
  });
});
