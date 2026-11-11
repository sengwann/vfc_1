import { describe, expect, it } from "vitest";

import {
  DeactivationConfigError,
  parseDeactivationConfig,
} from "./deactivation-config";

const HOUR = 60 * 60 * 1000;

describe("parseDeactivationConfig defaults", () => {
  it("uses a 24h cooldown, T-12h/T-1h reminders, 60s interval, batch 25", () => {
    expect(parseDeactivationConfig({})).toEqual({
      rejectionCooldownMs: 24 * HOUR,
      reminderOffsetsMs: [12 * HOUR, 1 * HOUR],
      workerIntervalMs: 60_000,
      workerBatchSize: 25,
    });
  });

  it("treats blank values as unset", () => {
    expect(
      parseDeactivationConfig({
        DEACTIVATION_REJECTION_COOLDOWN_HOURS: "  ",
        DEACTIVATION_REMINDER_HOURS: "",
      }).rejectionCooldownMs,
    ).toBe(24 * HOUR);
  });
});

describe("parseDeactivationConfig overrides", () => {
  it("accepts a custom cooldown, including fractions of an hour", () => {
    expect(
      parseDeactivationConfig({ DEACTIVATION_REJECTION_COOLDOWN_HOURS: "48" })
        .rejectionCooldownMs,
    ).toBe(48 * HOUR);
    expect(
      parseDeactivationConfig({ DEACTIVATION_REJECTION_COOLDOWN_HOURS: "0.5" })
        .rejectionCooldownMs,
    ).toBe(HOUR / 2);
  });

  it("sorts reminders largest first and removes duplicates", () => {
    expect(
      parseDeactivationConfig({ DEACTIVATION_REMINDER_HOURS: "1, 6,12,6" })
        .reminderOffsetsMs,
    ).toEqual([12 * HOUR, 6 * HOUR, 1 * HOUR]);
  });

  it("accepts worker interval and batch size", () => {
    const config = parseDeactivationConfig({
      DEACTIVATION_WORKER_INTERVAL_SECONDS: "30",
      DEACTIVATION_WORKER_BATCH_SIZE: "100",
    });
    expect(config.workerIntervalMs).toBe(30_000);
    expect(config.workerBatchSize).toBe(100);
  });
});

describe("parseDeactivationConfig rejects bad values", () => {
  const bad: Array<[string, string]> = [
    ["DEACTIVATION_REJECTION_COOLDOWN_HOURS", "0"],
    ["DEACTIVATION_REJECTION_COOLDOWN_HOURS", "-1"],
    ["DEACTIVATION_REJECTION_COOLDOWN_HOURS", "abc"],
    ["DEACTIVATION_REJECTION_COOLDOWN_HOURS", "1e3"],
    ["DEACTIVATION_REJECTION_COOLDOWN_HOURS", "100000"],
    ["DEACTIVATION_REMINDER_HOURS", "12,,1"],
    ["DEACTIVATION_REMINDER_HOURS", "0"],
    ["DEACTIVATION_REMINDER_HOURS", "24"],
    ["DEACTIVATION_REMINDER_HOURS", "36"],
    ["DEACTIVATION_REMINDER_HOURS", "twelve"],
    ["DEACTIVATION_WORKER_INTERVAL_SECONDS", "1"],
    ["DEACTIVATION_WORKER_INTERVAL_SECONDS", "10.5"],
    ["DEACTIVATION_WORKER_BATCH_SIZE", "0"],
    ["DEACTIVATION_WORKER_BATCH_SIZE", "1000"],
  ];

  for (const [name, value] of bad) {
    it(`throws for ${name}="${value}" instead of falling back`, () => {
      expect(() => parseDeactivationConfig({ [name]: value })).toThrow(
        DeactivationConfigError,
      );
    });
  }
});
