import { describe, expect, it } from "vitest";

import {
  canDeactivateHouse,
  canEditHouseNumber,
  canReactivateHouse,
} from "./house-rules";

describe("canEditHouseNumber", () => {
  it("is always allowed", () => {
    expect(canEditHouseNumber().allowed).toBe(true);
  });
});

describe("canDeactivateHouse", () => {
  it("allows an active house with no active or pending members", () => {
    expect(
      canDeactivateHouse({ isActive: true, hasActiveOrPendingMembers: false })
        .allowed,
    ).toBe(true);
  });

  it("blocks an already inactive house", () => {
    expect(
      canDeactivateHouse({ isActive: false, hasActiveOrPendingMembers: false })
        .allowed,
    ).toBe(false);
  });

  it("blocks a house with active or pending members", () => {
    expect(
      canDeactivateHouse({ isActive: true, hasActiveOrPendingMembers: true })
        .allowed,
    ).toBe(false);
  });
});

describe("canReactivateHouse", () => {
  it("allows an inactive house", () => {
    expect(canReactivateHouse({ isActive: false }).allowed).toBe(true);
  });

  it("blocks an already active house", () => {
    expect(canReactivateHouse({ isActive: true }).allowed).toBe(false);
  });
});
