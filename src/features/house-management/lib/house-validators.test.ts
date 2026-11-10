import { describe, expect, it } from "vitest";

import { normalizeHouseNumber, validateHouseNumber } from "./house-validators";

describe("normalizeHouseNumber", () => {
  it("trims, collapses spaces and uppercases", () => {
    expect(normalizeHouseNumber("  a   12 ")).toBe("A 12");
  });
});

describe("validateHouseNumber", () => {
  it("accepts and normalizes a normal number", () => {
    expect(validateHouseNumber("  a-12 ")).toEqual({
      ok: true,
      data: { houseNumber: "A-12" },
    });
  });

  it("accepts separators and parentheses", () => {
    expect(validateHouseNumber("a/12 (b)").ok).toBe(true);
  });

  it("accepts Myanmar digits", () => {
    expect(validateHouseNumber("၁၂")).toEqual({
      ok: true,
      data: { houseNumber: "၁၂" },
    });
  });

  it("rejects empty input", () => {
    expect(validateHouseNumber("   ")).toEqual({
      ok: false,
      fieldErrors: { houseNumber: "required" },
    });
  });

  it("rejects too short and too long", () => {
    expect(validateHouseNumber("A")).toEqual({
      ok: false,
      fieldErrors: { houseNumber: "length" },
    });
    expect(validateHouseNumber("A".repeat(31))).toEqual({
      ok: false,
      fieldErrors: { houseNumber: "length" },
    });
    expect(validateHouseNumber("A".repeat(30)).ok).toBe(true);
  });

  it("rejects disallowed characters", () => {
    expect(validateHouseNumber("A@12")).toEqual({
      ok: false,
      fieldErrors: { houseNumber: "chars" },
    });
  });

  it("rejects separators only", () => {
    expect(validateHouseNumber("--")).toEqual({
      ok: false,
      fieldErrors: { houseNumber: "noContent" },
    });
  });
});
