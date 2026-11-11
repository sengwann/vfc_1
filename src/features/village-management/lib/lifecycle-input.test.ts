import { describe, expect, it } from "vitest";

import {
  REASON_MAX_LENGTH,
  VILLAGE_ID_MAX_LENGTH,
  parseLifecycleInput,
  parseReason,
  parseVillageId,
} from "./lifecycle-input";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
}

describe("parseVillageId", () => {
  it("trims a valid id", () => {
    expect(parseVillageId("  abc123  ")).toBe("abc123");
  });

  it("rejects empty, blank, non-string and too-long values", () => {
    expect(parseVillageId("")).toBeNull();
    expect(parseVillageId("   ")).toBeNull();
    expect(parseVillageId(null)).toBeNull();
    expect(parseVillageId(42)).toBeNull();
    expect(parseVillageId("a".repeat(VILLAGE_ID_MAX_LENGTH + 1))).toBeNull();
    expect(parseVillageId("a".repeat(VILLAGE_ID_MAX_LENGTH))).not.toBeNull();
  });
});

describe("parseReason", () => {
  it("returns null reason for missing or blank input", () => {
    expect(parseReason(undefined)).toEqual({ ok: true, reason: null });
    expect(parseReason("   ")).toEqual({ ok: true, reason: null });
  });

  it("trims a valid reason", () => {
    expect(parseReason("  duplicate village ")).toEqual({
      ok: true,
      reason: "duplicate village",
    });
  });

  it("accepts exactly the max length and rejects one more", () => {
    expect(parseReason("a".repeat(REASON_MAX_LENGTH)).ok).toBe(true);
    expect(parseReason("a".repeat(REASON_MAX_LENGTH + 1)).ok).toBe(false);
  });

  it("counts an emoji as one character", () => {
    expect(parseReason("😀".repeat(REASON_MAX_LENGTH)).ok).toBe(true);
    expect(parseReason("😀".repeat(REASON_MAX_LENGTH + 1)).ok).toBe(false);
  });
});

describe("parseLifecycleInput", () => {
  it("returns villageId and reason", () => {
    expect(
      parseLifecycleInput(form({ villageId: "v1", reason: "why" })),
    ).toEqual({ ok: true, villageId: "v1", reason: "why" });
  });

  it("fails on an invalid village id", () => {
    expect(parseLifecycleInput(form({ reason: "why" }))).toEqual({
      ok: false,
      error: "INVALID_VILLAGE_ID",
    });
  });

  it("fails with the village id when the reason is too long", () => {
    expect(
      parseLifecycleInput(
        form({ villageId: "v1", reason: "a".repeat(REASON_MAX_LENGTH + 1) }),
      ),
    ).toEqual({ ok: false, error: "REASON_TOO_LONG", villageId: "v1" });
  });
});
