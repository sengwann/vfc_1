import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentPeriod } from "./period";

describe("getCurrentPeriod (Asia/Yangon)", () => {
  afterEach(() => vi.useRealTimers());

  it("returns the current month mid-month in UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    expect(getCurrentPeriod()).toEqual({ year: 2026, month: 10 });
  });

  it("rolls over 6.5h before UTC (Yangon 2026-10-01 00:30)", () => {
    // A naive UTC implementation would return { 2026, 9 }.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T18:00:00Z"));
    expect(getCurrentPeriod()).toEqual({ year: 2026, month: 10 });
  });

  it("stays in the previous month just before the Yangon boundary", () => {
    // 2026-09-30T17:29:00Z = Yangon 2026-09-30 23:59.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T17:29:00Z"));
    expect(getCurrentPeriod()).toEqual({ year: 2026, month: 9 });
  });

  it("rolls over the year at the Yangon boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T18:00:00Z"));
    expect(getCurrentPeriod()).toEqual({ year: 2027, month: 1 });
  });
});
