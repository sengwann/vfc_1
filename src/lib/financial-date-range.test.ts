import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFinancialDateRange } from "./financial-date-range";

afterEach(() => vi.unstubAllEnvs());
describe("Yangon financial date ranges", () => {
  it.each(["UTC", "America/Los_Angeles", "Asia/Tokyo"])("uses inclusive Yangon dates independent of host %s", (timezone) => {
    vi.stubEnv("TZ", timezone);
    const range = parseFinancialDateRange("2026-11-15", "2026-11-15");
    expect(range).toEqual({ ok: true, from: "2026-11-15", to: "2026-11-15",
      gte: new Date("2026-11-14T17:30:00Z"), lt: new Date("2026-11-15T17:30:00Z") });
    if (!range.ok || !range.gte || !range.lt) throw new Error("Missing bounds");
    const included = (instant: string) => new Date(instant) >= range.gte! && new Date(instant) < range.lt!;
    expect(included("2026-11-14T17:29:59.999Z")).toBe(false);
    expect(included("2026-11-14T17:30:00Z")).toBe(true);
    expect(included("2026-11-15T17:29:59.999Z")).toBe(true);
    expect(included("2026-11-15T17:30:00Z")).toBe(false);
  });
  it.each([
    ["2024-02-29", "2024-02-29", "2024-02-28T17:30:00Z", "2024-02-29T17:30:00Z"],
    ["2026-12-31", "2027-01-01", "2026-12-30T17:30:00Z", "2027-01-01T17:30:00Z"],
    ["2026-04-30", "2026-05-01", "2026-04-29T17:30:00Z", "2026-05-01T17:30:00Z"],
  ])("handles calendar rollover %s through %s", (from, to, start, end) => {
    expect(parseFinancialDateRange(from, to)).toEqual({ ok: true, from, to, gte: new Date(start), lt: new Date(end) });
  });
  it("supports unbounded and one-sided ranges", () => {
    expect(parseFinancialDateRange(undefined, "")).toEqual({ ok: true, from: "", to: "" });
    expect(parseFinancialDateRange("2026-01-01", undefined)).toEqual({ ok: true, from: "2026-01-01", to: "", gte: new Date("2025-12-31T17:30:00Z") });
    expect(parseFinancialDateRange(undefined, "2026-01-01")).toEqual({ ok: true, from: "", to: "2026-01-01", lt: new Date("2026-01-01T17:30:00Z") });
  });
  it.each(["2025-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "0000-01-01", "2026-1-01", " 2026-01-01", "2026-01-01T00:00:00Z", "garbage", null, 1])("rejects invalid scalar %s on either side", (value) => {
    expect(parseFinancialDateRange(value, undefined)).toEqual({ ok: false, error: "INVALID_FROM" });
    expect(parseFinancialDateRange(undefined, value)).toEqual({ ok: false, error: "INVALID_TO" });
  });
  it("rejects reversed dates and all array parameters without mutating them", () => {
    expect(parseFinancialDateRange("2026-02-02", "2026-02-01")).toEqual({ ok: false, error: "REVERSED" });
    for (const values of [[], ["2026-01-01"], ["2026-01-01", "2026-01-01"], ["2026-01-01", "2026-02-01"]]) {
      const original = [...values];
      expect(parseFinancialDateRange(values, undefined)).toEqual({ ok: false, error: "REPEATED_FROM" });
      expect(parseFinancialDateRange(undefined, values)).toEqual({ ok: false, error: "REPEATED_TO" });
      expect(values).toEqual(original);
    }
  });
});
