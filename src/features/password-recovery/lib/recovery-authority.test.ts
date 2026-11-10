import { describe, expect, it } from "vitest";

import {
  approverGroupFor,
  evaluateAuthority,
  isActiveChief,
  type AuthorityActor,
  type AuthorityTarget,
} from "./recovery-authority";

const chief = (overrides: Partial<AuthorityActor> = {}): AuthorityActor => ({
  id: "chief-a",
  role: "CHIEF",
  villageId: "village-a",
  membershipStatus: "ACTIVE",
  villageStatus: "ACTIVE",
  ...overrides,
});

const admin = (overrides: Partial<AuthorityActor> = {}): AuthorityActor => ({
  id: "admin-1",
  role: "SYSTEM_ADMIN",
  villageId: null,
  membershipStatus: null,
  villageStatus: null,
  ...overrides,
});

const villager = (overrides: Partial<AuthorityTarget> = {}): AuthorityTarget => ({
  id: "villager-a",
  role: "VILLAGER",
  villageId: "village-a",
  ...overrides,
});

const allowedAs = (as: "VILLAGE_CHIEF" | "SYSTEM_ADMIN") => ({
  allowed: true,
  as,
});
const DENIED = { allowed: false };

describe("isActiveChief", () => {
  it("needs the CHIEF role, ACTIVE membership and an ACTIVE village", () => {
    expect(isActiveChief(chief())).toBe(true);
    expect(isActiveChief(chief({ role: "VILLAGER" }))).toBe(false);
    expect(isActiveChief(chief({ membershipStatus: "REMOVED" }))).toBe(false);
    expect(isActiveChief(chief({ membershipStatus: "PENDING" }))).toBe(false);
    expect(isActiveChief(chief({ villageStatus: "SUSPENDED" }))).toBe(false);
    expect(isActiveChief(chief({ villageStatus: "DEACTIVATED" }))).toBe(false);
    expect(isActiveChief(chief({ villageId: null }))).toBe(false);
  });
});

describe("a Villager's request", () => {
  it("is handled by an active Chief of the same village", () => {
    expect(
      evaluateAuthority({
        actor: chief(),
        target: villager(),
        activeChiefCountInTargetVillage: 1,
      }),
    ).toEqual(allowedAs("VILLAGE_CHIEF"));
  });

  it("is never handled by a Chief of another village", () => {
    for (const count of [0, 1, 3]) {
      expect(
        evaluateAuthority({
          actor: chief({ villageId: "village-b" }),
          target: villager(),
          activeChiefCountInTargetVillage: count,
        }),
      ).toEqual(DENIED);
    }
  });

  it("is not handled by a Chief who is no longer active", () => {
    for (const actor of [
      chief({ membershipStatus: "REMOVED" }),
      chief({ villageStatus: "SUSPENDED" }),
    ]) {
      expect(
        evaluateAuthority({
          actor,
          target: villager(),
          activeChiefCountInTargetVillage: 0,
        }),
      ).toEqual(DENIED);
    }
  });

  it("is handled by a System Admin only while the village has no active Chief", () => {
    expect(
      evaluateAuthority({
        actor: admin(),
        target: villager(),
        activeChiefCountInTargetVillage: 0,
      }),
    ).toEqual(allowedAs("SYSTEM_ADMIN"));

    for (const count of [1, 2]) {
      expect(
        evaluateAuthority({
          actor: admin(),
          target: villager(),
          activeChiefCountInTargetVillage: count,
        }),
      ).toEqual(DENIED);
    }
  });

  it("is never handled by another Villager", () => {
    expect(
      evaluateAuthority({
        actor: chief({ id: "v2", role: "VILLAGER" }),
        target: villager(),
        activeChiefCountInTargetVillage: 1,
      }),
    ).toEqual(DENIED);
  });

  it("is refused when the target has no village on record", () => {
    expect(
      evaluateAuthority({
        actor: chief(),
        target: villager({ villageId: null }),
        activeChiefCountInTargetVillage: 1,
      }),
    ).toEqual(DENIED);
  });
});

describe("a Chief's request", () => {
  const target: AuthorityTarget = {
    id: "chief-b",
    role: "CHIEF",
    villageId: "village-a",
  };

  it("is handled by any System Admin", () => {
    expect(
      evaluateAuthority({
        actor: admin(),
        target,
        activeChiefCountInTargetVillage: 2,
      }),
    ).toEqual(allowedAs("SYSTEM_ADMIN"));
  });

  it("is never handled by another Chief, even in the same village", () => {
    expect(
      evaluateAuthority({
        actor: chief(),
        target,
        activeChiefCountInTargetVillage: 2,
      }),
    ).toEqual(DENIED);
  });
});

describe("a System Admin's request", () => {
  const target: AuthorityTarget = {
    id: "admin-2",
    role: "SYSTEM_ADMIN",
    villageId: null,
  };

  it("is handled by a different System Admin", () => {
    expect(
      evaluateAuthority({
        actor: admin(),
        target,
        activeChiefCountInTargetVillage: 0,
      }),
    ).toEqual(allowedAs("SYSTEM_ADMIN"));
  });

  it("is never handled by a Chief or a Villager", () => {
    for (const actor of [chief(), chief({ id: "v", role: "VILLAGER" })]) {
      expect(
        evaluateAuthority({ actor, target, activeChiefCountInTargetVillage: 0 }),
      ).toEqual(DENIED);
    }
  });
});

describe("nobody handles their own request", () => {
  it("refuses every role acting on itself", () => {
    expect(
      evaluateAuthority({
        actor: admin({ id: "same" }),
        target: { id: "same", role: "SYSTEM_ADMIN", villageId: null },
        activeChiefCountInTargetVillage: 0,
      }),
    ).toEqual(DENIED);
    expect(
      evaluateAuthority({
        actor: chief({ id: "same" }),
        target: { id: "same", role: "CHIEF", villageId: "village-a" },
        activeChiefCountInTargetVillage: 1,
      }),
    ).toEqual(DENIED);
    expect(
      evaluateAuthority({
        actor: admin({ id: "same" }),
        target: villager({ id: "same" }),
        activeChiefCountInTargetVillage: 0,
      }),
    ).toEqual(DENIED);
  });
});

describe("approverGroupFor (who is notified)", () => {
  it("tells the village's Chiefs about a Villager while one is active", () => {
    expect(
      approverGroupFor({
        target: villager(),
        activeChiefCountInTargetVillage: 2,
      }),
    ).toBe("VILLAGE_CHIEFS");
  });

  it("tells the System Admins about a Villager when the village has no active Chief", () => {
    expect(
      approverGroupFor({
        target: villager(),
        activeChiefCountInTargetVillage: 0,
      }),
    ).toBe("SYSTEM_ADMINS");
  });

  it("tells the System Admins about a Chief", () => {
    expect(
      approverGroupFor({
        target: { id: "c", role: "CHIEF", villageId: "village-a" },
        activeChiefCountInTargetVillage: 3,
      }),
    ).toBe("SYSTEM_ADMINS");
  });

  it("tells the other System Admins about a System Admin", () => {
    expect(
      approverGroupFor({
        target: { id: "a", role: "SYSTEM_ADMIN", villageId: null },
        activeChiefCountInTargetVillage: 0,
      }),
    ).toBe("OTHER_SYSTEM_ADMINS");
  });

  it("only ever notifies people who are allowed to act (full matrix)", () => {
    // For every target kind and Chief count, build an actor from the notified
    // group and confirm evaluateAuthority lets them act.
    const targets: AuthorityTarget[] = [
      villager(),
      { id: "c", role: "CHIEF", villageId: "village-a" },
      { id: "a", role: "SYSTEM_ADMIN", villageId: null },
    ];

    for (const target of targets) {
      for (const count of [0, 1, 4]) {
        const group = approverGroupFor({
          target,
          activeChiefCountInTargetVillage: count,
        });
        const actor =
          group === "VILLAGE_CHIEFS"
            ? chief({ villageId: target.villageId })
            : admin({ id: "another-admin" });

        expect(
          evaluateAuthority({
            actor,
            target,
            activeChiefCountInTargetVillage: count,
          }).allowed,
        ).toBe(true);
      }
    }
  });
});
