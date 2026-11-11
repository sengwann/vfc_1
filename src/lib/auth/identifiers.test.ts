import { describe, expect, it } from "vitest";

import { normalizeDigits, normalizeEmail, normalizePhone } from "./identifiers";

describe("normalizeDigits", () => {
  it("converts Myanmar digits to ASCII", () => {
    expect(normalizeDigits("၀၉၁၂၃၄၅၆၇၈၉")).toBe("09123456789");
  });

  it("leaves other characters alone", () => {
    expect(normalizeDigits("a-1 ၅")).toBe("a-1 5");
  });
});

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
  });

  it.each(["", "   ", "no-at-sign", "a@b", "a b@c.co"])(
    "rejects %j",
    (value) => {
      expect(normalizeEmail(value)).toBeNull();
    },
  );

  it("rejects an address longer than 191 characters", () => {
    expect(normalizeEmail(`${"a".repeat(190)}@b.co`)).toBeNull();
  });
});

describe("normalizePhone", () => {
  it("keeps the local Myanmar form", () => {
    expect(normalizePhone("09123456789")).toBe("09123456789");
  });

  it.each([
    "+959123456789",
    "959123456789",
    "00959123456789",
    "+95 9 123 456 789",
  ])("stores %j as 09...", (value) => {
    expect(normalizePhone(value)).toBe("09123456789");
  });

  it("accepts Myanmar digits and separators", () => {
    expect(normalizePhone("၀၉-၁၂၃ ၄၅၆ ၇၈၉")).toBe("09123456789");
  });

  it("keeps other international numbers as typed (without separators)", () => {
    expect(normalizePhone("+66 81 234 5678")).toBe("+66812345678");
  });

  it.each(["", "abc", "12", "09123456789012345678901234567890", "+"])(
    "rejects %j",
    (value) => {
      expect(normalizePhone(value)).toBeNull();
    },
  );

  it("makes the three typed forms of one number identical", () => {
    const forms = ["09123456789", "+959123456789", "၀၉၁၂၃၄၅၆၇၈၉"];
    expect(new Set(forms.map(normalizePhone)).size).toBe(1);
  });
});
