import { describe, expect, it } from "vitest";

import { getPeriodStatus } from "./collector-period";

const CURRENT = { year: 2026, month: 10 };

describe("getPeriodStatus", () => {
  it("returns 'current' for the same year and month", () => {
    expect(getPeriodStatus(2026, 10, CURRENT)).toBe("current");
  });

  it("returns 'past' for an earlier month or year", () => {
    expect(getPeriodStatus(2026, 9, CURRENT)).toBe("past");
    expect(getPeriodStatus(2025, 12, CURRENT)).toBe("past");
  });

  it("returns 'upcoming' for a later month or year", () => {
    expect(getPeriodStatus(2026, 11, CURRENT)).toBe("upcoming");
    expect(getPeriodStatus(2027, 1, CURRENT)).toBe("upcoming");
  });

  it("handles year rollover correctly", () => {
    expect(getPeriodStatus(2026, 12, { year: 2027, month: 1 })).toBe("past");
    expect(getPeriodStatus(2027, 1, { year: 2026, month: 12 })).toBe(
      "upcoming",
    );
  });
});
