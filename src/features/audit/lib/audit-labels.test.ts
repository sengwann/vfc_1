import { describe, expect, it } from "vitest";

import { en } from "@/lib/i18n/en";

import {
  formatMetadataValue,
  getActionLabel,
  getActionTone,
  getEntityLabel,
  getMetadataKeyLabel,
  getStatusLabel,
} from "./audit-labels";

const t = (key: keyof typeof en) => en[key];

describe("deactivation audit labels", () => {
  it("labels the new actions and entity, not the raw enum names", () => {
    expect(getActionLabel(t, "CANCEL")).toBe("Cancel");
    expect(getActionLabel(t, "COMPLETE")).toBe("Complete");
    expect(getActionTone("CANCEL")).toBe("warning");
    expect(getEntityLabel(t, "DEACTIVATION_REQUEST")).toBe("Deactivation request");
  });

  it("labels the workflow metadata keys", () => {
    for (const key of [
      "requestId",
      "reason",
      "outcome",
      "blockReason",
      "scheduledDeactivationAt",
      "cooldownEndsAt",
      "cancellationReason",
      "readOnly",
      "notificationDelivery",
    ]) {
      expect(getMetadataKeyLabel(t, key)).not.toBe(key);
    }
  });

  it("shows timestamps in Yangon time and translates outcomes and statuses", () => {
    // 2026-11-02T12:00Z is 6:30 pm in Yangon (UTC+06:30).
    expect(formatMetadataValue(t, "scheduledDeactivationAt", "2026-11-02T12:00:00.000Z")).toContain("06:30");
    expect(formatMetadataValue(t, "outcome", "BLOCKED")).toBe("Blocked");
    expect(formatMetadataValue(t, "notificationDelivery", "FAILED")).toBe("Failed");
    expect(getStatusLabel(t, "APPROVED")).toBe("Approved");
    expect(getStatusLabel(t, "DEACTIVATED")).toBe("Deactivated");
  });

  it("labels password recovery entries", () => {
    expect(getEntityLabel(t, "PASSWORD_RECOVERY_REQUEST")).toBe(
      "Password recovery request",
    );

    for (const key of [
      "event",
      "targetUserId",
      "issuedByUserId",
      "issueCount",
      "codeExpiresAt",
      "requestExpiresAt",
      "revocationReason",
      "failedAttempts",
      "clientFingerprint",
      "via",
    ]) {
      expect(getMetadataKeyLabel(t, key)).not.toBe(key);
    }
  });

  it("shows recovery events and reasons as words, and code expiry in Yangon time", () => {
    expect(formatMetadataValue(t, "event", "CODE_REISSUED")).toBe("Code reissued");
    expect(formatMetadataValue(t, "revocationReason", "TOO_MANY_ATTEMPTS")).toBe(
      "Too many attempts",
    );
    // 2026-11-04T12:00Z is 6:30 pm in Yangon (UTC+06:30).
    expect(formatMetadataValue(t, "codeExpiresAt", "2026-11-04T12:00:00.000Z")).toContain("06:30");
  });

  it("leaves an unparsable timestamp and unknown values as they are", () => {
    expect(formatMetadataValue(t, "approvedAt", "not a date")).toBe("not a date");
    expect(formatMetadataValue(t, "outcome", "OTHER")).toBe("OTHER");
  });
});
