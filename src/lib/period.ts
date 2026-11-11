const YANGON_TIME_ZONE = "Asia/Yangon";

/**
 * Returns the current year and month in Asia/Yangon time.
 *
 * Replit servers run in UTC. Yangon is UTC+6:30, so for the first 6.5 hours of a
 * new Yangon month the server still thinks it is the previous month. All business
 * period logic in this app uses Yangon time.
 *
 * Kept free of `server-only` and Prisma imports so it can be unit-tested.
 */
export function getCurrentPeriod(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: YANGON_TIME_ZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());

  return {
    year: Number(parts.find((p) => p.type === "year")?.value),
    month: Number(parts.find((p) => p.type === "month")?.value),
  };
}
