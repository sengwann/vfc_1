import { describe, expect, it } from "vitest";

import { canDeactivateAssignment } from "./collector-assignment-rules";

describe("canDeactivateAssignment", () => {
  it("allows current-period active assignments", () => {
    expect(canDeactivateAssignment(true, "current")).toBe(true);
  });

  it("allows upcoming-period active assignments", () => {
    expect(canDeactivateAssignment(true, "upcoming")).toBe(true);
  });

  it("refuses past-period active assignments (history lock)", () => {
    expect(canDeactivateAssignment(true, "past")).toBe(false);
  });

  it("refuses already-inactive assignments regardless of period", () => {
    expect(canDeactivateAssignment(false, "current")).toBe(false);
    expect(canDeactivateAssignment(false, "upcoming")).toBe(false);
    expect(canDeactivateAssignment(false, "past")).toBe(false);
  });
});
