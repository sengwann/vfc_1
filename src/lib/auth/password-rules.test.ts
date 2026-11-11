import { describe, expect, it } from "vitest";

import { checkPasswordRules } from "./password-rules";

describe("checkPasswordRules", () => {
  it("accepts a normal password", () => {
    expect(checkPasswordRules("correct-horse")).toBeNull();
  });

  it("rejects fewer than 8 characters", () => {
    expect(checkPasswordRules("short")).toBe("LENGTH");
  });

  it("accepts exactly 8 and exactly 72 ASCII characters", () => {
    expect(checkPasswordRules("a".repeat(8))).toBeNull();
    expect(checkPasswordRules("a".repeat(72))).toBeNull();
  });

  it("rejects more than 72 characters", () => {
    expect(checkPasswordRules("a".repeat(73))).toBe("LENGTH");
  });

  it("rejects a Myanmar password over 72 bytes even if under 72 characters", () => {
    const burmese = "က".repeat(25); // 25 characters, 75 bytes
    expect(burmese.length).toBeLessThan(72);
    expect(checkPasswordRules(burmese)).toBe("TOO_MANY_BYTES");
  });

  it("accepts a Myanmar password of exactly 72 bytes", () => {
    expect(checkPasswordRules("က".repeat(24))).toBeNull();
  });
});
