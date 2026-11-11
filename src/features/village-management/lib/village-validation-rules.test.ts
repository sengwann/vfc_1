import { describe, expect, it } from "vitest";

import {
  PASSWORD_MAX_LENGTH,
  getUtf8ByteLength,
  normalizeVillageCode,
  validateChiefName,
  validatePassword,
  validateVillageCode,
  validateVillageName,
} from "./village-validation-rules";

describe("village code", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeVillageCode("  dev 101 ")).toBe("DEV101");
  });

  it("accepts 3 to 20 uppercase letters or digits", () => {
    expect(validateVillageCode("ABC")).toBeNull();
    expect(validateVillageCode("A".repeat(20))).toBeNull();
  });

  it("rejects bad codes", () => {
    expect(validateVillageCode("AB")).toBe("CODE_INVALID");
    expect(validateVillageCode("A".repeat(21))).toBe("CODE_INVALID");
    expect(validateVillageCode("AB-1")).toBe("CODE_INVALID");
    expect(validateVillageCode("abc")).toBe("CODE_INVALID");
  });
});

describe("names", () => {
  it("village name must be 2 to 100 characters", () => {
    expect(validateVillageName("A")).toBe("NAME_LENGTH");
    expect(validateVillageName("AB")).toBeNull();
    expect(validateVillageName("a".repeat(100))).toBeNull();
    expect(validateVillageName("a".repeat(101))).toBe("NAME_LENGTH");
  });

  it("chief name must be 2 to 100 characters", () => {
    expect(validateChiefName("A")).toBe("CHIEF_NAME_LENGTH");
    expect(validateChiefName("AB")).toBeNull();
    expect(validateChiefName("a".repeat(101))).toBe("CHIEF_NAME_LENGTH");
  });
});

describe("validatePassword", () => {
  it("enforces the length range", () => {
    expect(validatePassword("1234567")).toBe("PASSWORD_LENGTH");
    expect(validatePassword("12345678")).toBeNull();
    expect(validatePassword("a".repeat(PASSWORD_MAX_LENGTH))).toBeNull();
    expect(validatePassword("a".repeat(PASSWORD_MAX_LENGTH + 1))).toBe(
      "PASSWORD_LENGTH",
    );
  });

  it("rejects passwords over 72 bytes even when under 72 characters", () => {
    const burmese = "က".repeat(30); // 30 characters, 90 bytes
    expect(burmese.length).toBeLessThanOrEqual(PASSWORD_MAX_LENGTH);
    expect(getUtf8ByteLength(burmese)).toBe(90);
    expect(validatePassword(burmese)).toBe("PASSWORD_TOO_LONG");
  });
});
