/*
 * Presentation-only helpers for the fund screens. No server-only import, so
 * client components can use it. Dates arrive as ISO strings (server pages
 * serialise them) and are formatted in UTC, matching how fund dates are stored.
 */

export function formatFundDate(iso: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** Whole-number percentage, clamped to 0–100. Floors so 99.6% never shows 100%. */
export function getProgressPercent(collected: number, target: number): number {
  if (!Number.isFinite(collected) || !Number.isFinite(target) || target <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.floor((collected / target) * 100)));
}
