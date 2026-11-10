import { describe, expect, it } from "vitest";

import { decisionRedirect, issueErrorFor, redeemErrorFor } from "./recovery-results";

describe("issueErrorFor", () => {
  it("maps every refusal to a code the form can translate", () => {
    expect(issueErrorFor({ kind: "bad_password" })).toBe("bad_password");
    expect(issueErrorFor({ kind: "throttled", retryAfterSeconds: 5 })).toBe("throttled");
    expect(issueErrorFor({ kind: "not_found" })).toBe("not_found");
    expect(issueErrorFor({ kind: "blocked", reason: "EXPIRED" })).toBe("expired");
    expect(issueErrorFor({ kind: "blocked", reason: "RATE_LIMITED" })).toBe("rate_limited");
    expect(issueErrorFor({ kind: "blocked", reason: "SELF_ACTION" })).toBe("self_action");
    expect(issueErrorFor({ kind: "blocked", reason: "NOT_ELIGIBLE" })).toBe("not_eligible");
    expect(issueErrorFor({ kind: "blocked", reason: "VILLAGE_NOT_ACTIVE" })).toBe("not_eligible");
    expect(issueErrorFor({ kind: "blocked", reason: "WRONG_STATE" })).toBe("wrong_state");
  });
});

describe("redeemErrorFor", () => {
  it("keeps every code failure indistinguishable", () => {
    expect(redeemErrorFor({ kind: "invalid" })).toBe("invalid_code");
    expect(redeemErrorFor({ kind: "weak_password", reason: "LENGTH" })).toBe("password_length");
    expect(redeemErrorFor({ kind: "weak_password", reason: "TOO_MANY_BYTES" })).toBe("password_bytes");
    expect(redeemErrorFor({ kind: "throttled", retryAfterSeconds: 9 })).toBe("throttled");
  });
});

describe("decisionRedirect", () => {
  it("sends successes as notices and refusals as errors", () => {
    expect(decisionRedirect({ kind: "rejected", requestId: "r", villageId: null })).toEqual({
      kind: "notice",
      code: "rejected",
    });
    expect(decisionRedirect({ kind: "withdrawn", requestId: "r", villageId: null })).toEqual({
      kind: "notice",
      code: "withdrawn",
    });
    expect(decisionRedirect({ kind: "not_found" })).toEqual({ kind: "error", code: "not_found" });
    expect(decisionRedirect({ kind: "invalid_note", reason: "REQUIRED" })).toEqual({
      kind: "error",
      code: "note_required",
    });
    expect(decisionRedirect({ kind: "invalid_note", reason: "TOO_LONG" })).toEqual({
      kind: "error",
      code: "note_too_long",
    });
    expect(decisionRedirect({ kind: "invalid_note", reason: "NOT_TEXT" })).toEqual({
      kind: "error",
      code: "note_invalid",
    });
    expect(decisionRedirect({ kind: "blocked", reason: "EXPIRED" })).toEqual({
      kind: "error",
      code: "expired",
    });
    expect(decisionRedirect({ kind: "blocked", reason: "WRONG_STATE" })).toEqual({
      kind: "error",
      code: "wrong_state",
    });
  });
});
