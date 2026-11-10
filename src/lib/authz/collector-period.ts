const YANGON_TIME_ZONE = "Asia/Yangon";

/**
 * Returns the current year and month in Asia/Yangon time.
 *
 * Replit servers normally run in UTC, so using `new Date().getFullYear()`
 * would return the previous month for the first 6.5 hours of a new month
 * in Yangon. That would let the previous month's collector keep cash
 * authority and deny the new one. All period logic in this app uses
 * Yangon time.
 */
export function getCurrentPeriod(at: Date = new Date()): {
  year: number;
  month: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: YANGON_TIME_ZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(at);

  const yearPart = parts.find((part) => part.type === "year");
  const monthPart = parts.find((part) => part.type === "month");

  return {
    year: Number(yearPart?.value),
    month: Number(monthPart?.value),
  };
}

