import { describe, expect, it } from "vitest";

import { en } from "../../../lib/i18n/en";
import {
  describeRecoveryNotification,
  resolveRecoveryFeedback,
} from "./recovery-view";

const t = (key: keyof typeof en) => en[key];
const format = (date: Date) => `D:${date.toISOString()}`;

describe("describeRecoveryNotification", () => {
  it("tells the member when and by whom the password was changed", () => {
    const text = describeRecoveryNotification(
      t,
      "RECOVERY_PASSWORD_CHANGED",
      {
        completedAt: "2026-11-04T10:00:00.000Z",
        issuedByName: "U Mya",
        issuedByRole: "CHIEF",
      },
      format,
    );

    expect(text?.title).toBe("Your password was changed");
    expect(text?.body.includes("D:2026-11-04T10:00:00.000Z")).toBe(true);
    expect(text?.body.includes("U Mya (Chief)")).toBe(true);
  });

  it("appends the rejection note only when there is one", () => {
    const base = { rejectedAt: "2026-11-04T10:00:00.000Z", rejectedByName: "U Mya", rejectedByRole: "CHIEF" };
    const withNote = describeRecoveryNotification(t, "RECOVERY_REJECTED", { ...base, rejectionNote: "Call me" }, format);
    const without = describeRecoveryNotification(t, "RECOVERY_REJECTED", { ...base, rejectionNote: "" }, format);

    expect(withNote?.body.endsWith("Note: Call me")).toBe(true);
    expect(without?.body.includes("Note:")).toBe(false);
  });

  it("keeps stored text literal and ignores unknown types", () => {
    const text = describeRecoveryNotification(
      t,
      "RECOVERY_REQUESTED",
      { targetName: "{expires} {name}", requestExpiresAt: "2026-11-11T10:00:00.000Z" },
      format,
    );

    expect(text?.body.includes("{expires} {name}")).toBe(true);
    expect(describeRecoveryNotification(t, "DEACTIVATION_APPROVED", {}, format)).toBe(null);
  });
});

describe("resolveRecoveryFeedback", () => {
  it("shows known codes and nothing for unknown ones", () => {
    expect(resolveRecoveryFeedback(t, { error: "note_required", notice: null })?.tone).toBe("danger");
    expect(resolveRecoveryFeedback(t, { error: null, notice: "withdrawn" })?.message).toBe("Code withdrawn.");
    expect(resolveRecoveryFeedback(t, { error: "<script>", notice: null })).toBe(null);
    expect(resolveRecoveryFeedback(t, { error: null, notice: null })).toBe(null);
  });
});
