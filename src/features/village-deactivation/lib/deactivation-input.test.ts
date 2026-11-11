import { describe, expect, it } from "vitest";

import {
  DEACTIVATION_REASON_MAX_LENGTH,
  parseApproveInput,
  parseCancelInput,
  parseConfirmation,
  parseRejectInput,
  parseRequiredReason,
  parseSubmitRequestInput,
} from "./deactivation-input";

function form(values: Record<string, string>): FormData {
  const data = new FormData();

  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }

  return data;
}

describe("parseRequiredReason", () => {
  it("trims and returns a valid reason", () => {
    expect(parseRequiredReason("  Village merged  ")).toEqual({
      ok: true,
      reason: "Village merged",
    });
  });

  it("requires a reason: missing, non-string, empty and blank are refused", () => {
    for (const value of [undefined, null, 5, "", "   ", "\n\t"]) {
      expect(parseRequiredReason(value)).toEqual({
        ok: false,
        error: "REASON_REQUIRED",
      });
    }
  });

  it("accepts exactly the maximum length and refuses one more", () => {
    const max = "a".repeat(DEACTIVATION_REASON_MAX_LENGTH);
    expect(parseRequiredReason(max).ok).toBe(true);
    expect(parseRequiredReason(`${max}a`)).toEqual({
      ok: false,
      error: "REASON_TOO_LONG",
    });
  });

  it("counts an emoji as one character", () => {
    expect(parseRequiredReason("😀".repeat(DEACTIVATION_REASON_MAX_LENGTH)).ok).toBe(
      true,
    );
  });
});

describe("parseSubmitRequestInput", () => {
  it("needs only a reason; the village comes from the session", () => {
    expect(parseSubmitRequestInput(form({ reason: "Closing" }))).toEqual({
      ok: true,
      reason: "Closing",
    });
    expect(parseSubmitRequestInput(form({}))).toEqual({
      ok: false,
      error: "REASON_REQUIRED",
    });
  });

  it("ignores a village id in the form", () => {
    expect(
      parseSubmitRequestInput(form({ reason: "Closing", villageId: "other" })),
    ).toEqual({ ok: true, reason: "Closing" });
  });
});

describe("parseApproveInput", () => {
  it("needs a request id", () => {
    expect(parseApproveInput(form({ requestId: " req1 " }))).toEqual({
      ok: true,
      requestId: "req1",
    });
    for (const requestId of ["", "  ", "x".repeat(65)]) {
      expect(parseApproveInput(form({ requestId }))).toEqual({
        ok: false,
        error: "INVALID_REQUEST_ID",
      });
    }
    expect(parseApproveInput(form({}))).toEqual({
      ok: false,
      error: "INVALID_REQUEST_ID",
    });
  });
});

describe("parseRejectInput", () => {
  it("requires a request id and a reason", () => {
    expect(parseRejectInput(form({ requestId: "r1", reason: "No" }))).toEqual({
      ok: true,
      requestId: "r1",
      reason: "No",
    });
    expect(parseRejectInput(form({ requestId: "r1" }))).toEqual({
      ok: false,
      error: "REASON_REQUIRED",
    });
    expect(parseRejectInput(form({ reason: "No" }))).toEqual({
      ok: false,
      error: "INVALID_REQUEST_ID",
    });
  });
});

describe("parseCancelInput", () => {
  const valid = { requestId: "r1", reason: "Changed our mind", confirm: "on" };

  it("requires a request id, a reason and explicit confirmation", () => {
    expect(parseCancelInput(form(valid))).toEqual({
      ok: true,
      requestId: "r1",
      reason: "Changed our mind",
    });
    expect(parseCancelInput(form({ ...valid, reason: " " }))).toEqual({
      ok: false,
      error: "REASON_REQUIRED",
    });
    expect(parseCancelInput(form({ ...valid, confirm: "" }))).toEqual({
      ok: false,
      error: "CONFIRMATION_REQUIRED",
    });
    expect(
      parseCancelInput(form({ requestId: "r1", reason: "x" })),
    ).toEqual({ ok: false, error: "CONFIRMATION_REQUIRED" });
  });
});

describe("parseConfirmation", () => {
  it("accepts only on and true", () => {
    expect(parseConfirmation("on")).toBe(true);
    expect(parseConfirmation("true")).toBe(true);
    for (const value of ["", "false", "yes", "1", "ON", null, undefined, true]) {
      expect(parseConfirmation(value)).toBe(false);
    }
  });
});
