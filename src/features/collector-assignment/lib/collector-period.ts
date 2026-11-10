export type PeriodStatus = "past" | "current" | "upcoming";

export function getPeriodStatus(
  year: number,
  month: number,
  current: { year: number; month: number },
): PeriodStatus {
  if (year === current.year && month === current.month) {
    return "current";
  }
  if (year < current.year || (year === current.year && month < current.month)) {
    return "past";
  }
  return "upcoming";
}
