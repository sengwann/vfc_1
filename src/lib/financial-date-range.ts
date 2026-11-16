/** Reporting calendar dates use Myanmar business time (UTC+06:30).
 * This is a calendar filter, not a historical/as-of financial snapshot.
 * No host-local Date getters or database/session timezone settings are used.
 */
export type FinancialDateRangeError =
  | "INVALID_FROM" | "INVALID_TO" | "REPEATED_FROM" | "REPEATED_TO" | "REVERSED";

export type FinancialDateRange =
  | { ok: true; from: string; to: string; gte?: Date; lt?: Date }
  | { ok: false; error: FinancialDateRangeError };

const DAY_MS = 86_400_000;
const YANGON_OFFSET_MS = 390 * 60_000;

function calendarDay(raw: unknown): number | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || raw.startsWith("0000-")) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw
    ? date.getTime() : null;
}

/** Empty scalar/undefined means unbounded. Any array is rejected, including
 * repeated identical values, so query parsers cannot disagree about the range.
 * Supported calendar years: 0001–9999, using the fixed Myanmar business offset.
 */
export function parseFinancialDateRange(from: unknown, to: unknown): FinancialDateRange {
  if (Array.isArray(from)) return { ok: false, error: "REPEATED_FROM" };
  if (Array.isArray(to)) return { ok: false, error: "REPEATED_TO" };
  const start = from === undefined || from === "" ? undefined : calendarDay(from);
  const end = to === undefined || to === "" ? undefined : calendarDay(to);
  if (start === null) return { ok: false, error: "INVALID_FROM" };
  if (end === null) return { ok: false, error: "INVALID_TO" };
  if (start !== undefined && end !== undefined && start > end) return { ok: false, error: "REVERSED" };
  return {
    ok: true,
    from: typeof from === "string" ? from : "",
    to: typeof to === "string" ? to : "",
    ...(start === undefined ? {} : { gte: new Date(start - YANGON_OFFSET_MS) }),
    ...(end === undefined ? {} : { lt: new Date(end + DAY_MS - YANGON_OFFSET_MS) }),
  };
}
