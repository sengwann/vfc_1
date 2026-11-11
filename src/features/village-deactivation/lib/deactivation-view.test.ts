import { describe, expect, it } from "vitest";

import { en } from "../../../lib/i18n/en";
import { my } from "../../../lib/i18n/my";
import {
  computeCountdown,
  describeNotification,
  formatCountdown,
  formatDuration,
  resolveFeedback,
  showCancelForm,
  type Translate,
} from "./deactivation-view";

const t: Translate = (key) => en[key];
const fmt = (date: Date) => date.toISOString();
const DEADLINE = new Date("2026-11-02T12:00:00.000Z");

describe("countdown", () => {
  it("counts down to the stored deadline", () => {
    const c = computeCountdown(new Date("2026-11-02T06:56:51.000Z"), DEADLINE);
    expect([c.hours, c.minutes, c.seconds]).toEqual([5, 3, 9]);
    expect(c.overdue).toBe(false);
    expect(formatCountdown(c)).toBe("05:03:09");
  });

  it("is overdue exactly at the deadline, matching the exclusive cancel boundary", () => {
    expect(computeCountdown(DEADLINE, DEADLINE).overdue).toBe(true);
    expect(showCancelForm(DEADLINE, DEADLINE)).toBe(false);
    expect(showCancelForm(new Date(DEADLINE.getTime() - 1), DEADLINE)).toBe(true);
  });

  it("never goes negative", () => {
    const c = computeCountdown(new Date(DEADLINE.getTime() + 5000), DEADLINE);
    expect(c.remainingMs).toBe(0);
    expect(formatCountdown(c)).toBe("00:00:00");
  });
});

describe("resolveFeedback", () => {
  const none = { error: null, notice: null, until: null };

  it("maps known codes and ignores unknown ones", () => {
    expect(resolveFeedback(t, { ...none, error: "busy" }, fmt)?.tone).toBe("danger");
    expect(resolveFeedback(t, { ...none, notice: "approved" }, fmt)?.tone).toBe("success");
    expect(resolveFeedback(t, { ...none, error: "<script>" }, fmt)).toBeNull();
    expect(resolveFeedback(t, none, fmt)).toBeNull();
  });

  it("shows the cooldown end, or a generic text when it is missing or invalid", () => {
    const withDate = resolveFeedback(
      t,
      { error: "cooldown_active", notice: null, until: "2026-11-03T00:00:00.000Z" },
      fmt,
    );
    expect(withDate?.message).toContain("2026-11-03T00:00:00.000Z");

    for (const until of [null, "garbage"]) {
      const generic = resolveFeedback(
        t,
        { error: "cooldown_active", notice: null, until },
        fmt,
      );
      expect(generic?.message).toBe(en["deact.err.cooldown_active_generic"]);
    }
  });
});

describe("describeNotification", () => {
  it("renders an approval with the deadline", () => {
    const out = describeNotification(
      t,
      "DEACTIVATION_APPROVED",
      { villageName: "Alpha", scheduledDeactivationAt: DEADLINE.toISOString() },
      fmt,
    );
    expect(out?.body).toContain("Alpha");
    expect(out?.body).toContain(DEADLINE.toISOString());
  });

  it("renders a rejection with reason and cooldown end", () => {
    const out = describeNotification(
      t,
      "DEACTIVATION_REJECTED",
      { villageName: "Alpha", rejectionReason: "Not now", cooldownEndsAt: DEADLINE.toISOString() },
      fmt,
    );
    expect(out?.body).toContain("Not now");
    expect(out?.body).toContain(DEADLINE.toISOString());
  });

  it("renders reminder durations", () => {
    expect(formatDuration(t, 720)).toBe("12 h");
    expect(formatDuration(t, 60)).toBe("1 h");
    expect(formatDuration(t, 45)).toBe("45 min");
    const out = describeNotification(
      t,
      "DEACTIVATION_REMINDER",
      { villageName: "A", scheduledDeactivationAt: DEADLINE.toISOString(), offsetMinutes: 60 },
      fmt,
    );
    expect(out?.body).toContain("1 h");
  });

  it("returns null for an unknown type and tolerates bad params", () => {
    expect(describeNotification(t, "SOMETHING_ELSE", {}, fmt)).toBeNull();
    expect(describeNotification(t, "DEACTIVATION_COMPLETED", null, fmt)?.body).toContain("—");
  });

  it("never interprets stored text as markup or template", () => {
    const out = describeNotification(
      t,
      "DEACTIVATION_CANCELLED",
      { villageName: "{reason}", villageCode: "X", reason: "<b>hi</b>" },
      fmt,
    );
    expect(out?.body).toContain("<b>hi</b>");
    // The village name "{reason}" stays literal instead of being substituted again.
    expect(out?.body.startsWith("{reason} (X)")).toBe(true);
  });
});

describe("translations", () => {
  it("every deactivation key exists in both languages and is non-empty", () => {
    const keys = Object.keys(en).filter((k) => /^(deact\.|audit\.meta\.|audit\.value\.)/.test(k));
    expect(keys.length).toBeGreaterThan(60);
    for (const key of keys) {
      expect((my as Record<string, string>)[key]).toBeDefined();
      expect((my as Record<string, string>)[key].length).toBeGreaterThan(0);
    }
  });

  it("placeholders match between English and Burmese", () => {
    const placeholders = (s: string) => (s.match(/\{[a-z]+\}/gi) ?? []).sort().join(",");
    for (const key of Object.keys(en).filter((k) => k.startsWith("deact."))) {
      expect(placeholders((my as Record<string, string>)[key])).toBe(
        placeholders((en as Record<string, string>)[key]),
      );
    }
  });
});
