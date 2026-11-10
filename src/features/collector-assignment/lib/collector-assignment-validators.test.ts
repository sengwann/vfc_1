import { describe, expect, it } from "vitest";

import { validateAssignCollectorInput } from "./collector-assignment-validators";

function formData(values: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) {
    fd.set(key, value);
  }
  return fd;
}

const CURRENT = { year: 2026, month: 10 };

describe("validateAssignCollectorInput", () => {
  // Regression: strict integer parsing (old parseInt accepted "12abc").
  it("rejects a loose integer like '12abc' in month", () => {
    const result = validateAssignCollectorInput(
      formData({ userId: "u1", year: "2026", month: "12abc" }),
      CURRENT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.month).toBeDefined();
    }
  });

  it("rejects a loose integer like '2026abc' in year", () => {
    const result = validateAssignCollectorInput(
      formData({ userId: "u1", year: "2026abc", month: "10" }),
      CURRENT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.year).toBeDefined();
    }
  });

  it("rejects negative integers", () => {
    const result = validateAssignCollectorInput(
      formData({ userId: "u1", year: "-1", month: "10" }),
      CURRENT,
    );
    expect(result.ok).toBe(false);
  });

  // Regression: year cap is currentYear + 1, not 2100.
  it("rejects a year beyond currentYear + 1", () => {
    const result = validateAssignCollectorInput(
      formData({ userId: "u1", year: "2028", month: "1" }),
      CURRENT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.year).toBeDefined();
    }
  });

  it("accepts currentYear + 1", () => {
    const result = validateAssignCollectorInput(
      formData({ userId: "u1", year: "2027", month: "1" }),
      CURRENT,
    );
    expect(result.ok).toBe(true);
  });

  // Regression: past-period lock (history rewrite guard).
  it("rejects a past month in the current year", () => {
    const result = validateAssignCollectorInput(
      formData({ userId: "u1", year: "2026", month: "9" }),
      CURRENT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.fieldErrors.month).toMatch(/past period/);
    }
  });

  it("rejects a past year", () => {
    const result = validateAssignCollectorInput(
      formData({ userId: "u1", year: "2025", month: "12" }),
      CURRENT,
    );
    expect(result.ok).toBe(false);
  });

  // Happy path: confirms valid input survives all guards.
  it("accepts the current period", () => {
    const result = validateAssignCollectorInput(
      formData({ userId: "u1", year: "2026", month: "10" }),
      CURRENT,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ userId: "u1", year: 2026, month: 10 });
    }
  });
});
