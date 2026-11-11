import { describe, expect, it } from "vitest";

import {
  ADMIN_DEACTIVATION_PATH,
  CHIEF_DEACTIVATION_PATH,
  approveResult,
  cancelResult,
  inputErrorResult,
  rejectResult,
  resultPath,
  submitResult,
} from "./deactivation-results";

const until = new Date("2026-10-29T10:00:00.000Z");

describe("submitResult", () => {
  it("maps every outcome to a stable code", () => {
    expect(submitResult({ kind: "created", requestId: "r1" })).toEqual({ type: "success", notice: "submitted" });
    expect(submitResult({ kind: "forbidden" })).toEqual({ type: "forbidden" });
    expect(submitResult({ kind: "invalid_reason", error: "REASON_REQUIRED" })).toEqual({ type: "error", error: "reason_required" });
    expect(submitResult({ kind: "invalid_reason", error: "REASON_TOO_LONG" })).toEqual({ type: "error", error: "reason_too_long" });
    expect(submitResult({ kind: "blocked", reason: "UNRESOLVED_REQUEST_EXISTS" })).toEqual({ type: "error", error: "unresolved_request_exists" });
    expect(submitResult({ kind: "blocked", reason: "VILLAGE_NOT_ACTIVE" })).toEqual({ type: "error", error: "village_not_active" });
  });

  it("carries the cooldown end so the page can show it", () => {
    expect(submitResult({ kind: "blocked", reason: "COOLDOWN_ACTIVE", cooldownEndsAt: until })).toEqual({ type: "error", error: "cooldown_active", until });
  });
});

describe("approveResult and rejectResult", () => {
  it("map approve outcomes", () => {
    const approved = { kind: "approved" as const, requestId: "r1", villageId: "v1", approvedAt: until, scheduledDeactivationAt: until };
    expect(approveResult(approved)).toEqual({ type: "success", notice: "approved" });
    expect(approveResult({ kind: "not_found" })).toEqual({ type: "not_found" });
    expect(approveResult({ kind: "forbidden" })).toEqual({ type: "forbidden" });
    expect(approveResult({ kind: "blocked", reason: "NOT_PENDING" })).toEqual({ type: "error", error: "not_pending" });
    expect(approveResult({ kind: "blocked", reason: "VILLAGE_NOT_ACTIVE" })).toEqual({ type: "error", error: "village_not_active" });
  });

  it("map reject outcomes", () => {
    const rejected = { kind: "rejected" as const, requestId: "r1", villageId: "v1", rejectedAt: until, cooldownEndsAt: until };
    expect(rejectResult(rejected)).toEqual({ type: "success", notice: "rejected" });
    expect(rejectResult({ kind: "invalid_reason", error: "REASON_REQUIRED" })).toEqual({ type: "error", error: "reason_required" });
    expect(rejectResult({ kind: "blocked", reason: "NOT_PENDING" })).toEqual({ type: "error", error: "not_pending" });
    expect(rejectResult({ kind: "not_found" })).toEqual({ type: "not_found" });
    expect(rejectResult({ kind: "forbidden" })).toEqual({ type: "forbidden" });
  });
});

describe("cancelResult", () => {
  it("maps cancel outcomes, including a refusal after the deadline", () => {
    expect(cancelResult({ kind: "cancelled", requestId: "r1", villageId: "v1", cancelledAt: until })).toEqual({ type: "success", notice: "cancelled" });
    expect(cancelResult({ kind: "blocked", reason: "DEADLINE_REACHED" })).toEqual({ type: "error", error: "deadline_reached" });
    expect(cancelResult({ kind: "blocked", reason: "NOT_APPROVED" })).toEqual({ type: "error", error: "not_approved" });
    expect(cancelResult({ kind: "blocked", reason: "MISSING_DEADLINE" })).toEqual({ type: "error", error: "not_approved" });
    expect(cancelResult({ kind: "invalid_reason", error: "REASON_REQUIRED" })).toEqual({ type: "error", error: "reason_required" });
    expect(cancelResult({ kind: "not_found" })).toEqual({ type: "not_found" });
    expect(cancelResult({ kind: "forbidden" })).toEqual({ type: "forbidden" });
  });
});

describe("inputErrorResult", () => {
  it("maps form errors, including the missing confirmation", () => {
    expect(inputErrorResult("CONFIRMATION_REQUIRED")).toEqual({ type: "error", error: "confirmation_required" });
    expect(inputErrorResult("INVALID_REQUEST_ID")).toEqual({ type: "error", error: "invalid_request" });
  });
});

describe("resultPath", () => {
  it("adds a notice or an error code to the page", () => {
    expect(resultPath(CHIEF_DEACTIVATION_PATH, { type: "success", notice: "submitted" })).toBe("/village/deactivation?notice=submitted");
    expect(resultPath(ADMIN_DEACTIVATION_PATH, { type: "error", error: "not_pending" })).toBe("/admin/deactivation-requests?error=not_pending");
  });

  it("adds the cooldown end as an ISO timestamp", () => {
    expect(resultPath(CHIEF_DEACTIVATION_PATH, { type: "error", error: "cooldown_active", until })).toBe(
      "/village/deactivation?error=cooldown_active&until=2026-10-29T10%3A00%3A00.000Z",
    );
  });

  it("sends a missing request to the plain page", () => {
    expect(resultPath(ADMIN_DEACTIVATION_PATH, { type: "not_found" })).toBe("/admin/deactivation-requests");
  });
});

it("maps ACTIVE-Fund approval refusal to its specific query error", () => {
  expect(approveResult({ kind: "blocked", reason: "ACTIVE_FUND_EXISTS" })).toEqual({ type: "error", error: "active_fund_exists" });
});
