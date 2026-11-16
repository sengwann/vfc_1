import { parseFinancialDateRange } from "@/lib/financial-date-range";

export type HistoryParams = Record<string, string | string[] | undefined>;
export type HistoryError = "FILTER" | "DATE" | "REPEATED" | "REVERSED" | "CURSOR" | "STALE" | "UNAVAILABLE";
export function parseHistoryFilters(params: HistoryParams) {
  const dateRange = parseFinancialDateRange(params.dateFrom, params.dateTo);
  if (!dateRange.ok) return { ok: false as const, error: (dateRange.error.startsWith("REPEATED") ? "REPEATED" : dateRange.error === "REVERSED" ? "REVERSED" : "DATE") as HistoryError };
  for (const key of ["fundId", "status", "cursor", "direction"]) {
    if (Array.isArray(params[key])) return { ok: false as const, error: "REPEATED" as const };
  }
  const fundId = params.fundId as string | undefined;
  const status = params.status as string | undefined;
  const cursor = params.cursor as string | undefined;
  const direction = params.direction as string | undefined;
  if ((fundId && (fundId.length > 128 || fundId.trim() !== fundId || /[\s\x00-\x1f]/.test(fundId))) ||
      (status && status !== "ACCEPTED" && status !== "VOIDED")) return { ok: false as const, error: "FILTER" as const };
  if ((cursor && cursor.length > 1024) || (direction && direction !== "older" && direction !== "newer") ||
      Boolean(cursor) !== Boolean(direction)) return { ok: false as const, error: "CURSOR" as const };
  return { ok: true as const, fundId: fundId || "", status: (status || "") as "" | "ACCEPTED" | "VOIDED",
    dateRange, cursor: cursor || "", direction: direction as "older" | "newer" | undefined };
}
export type ValidHistoryFilters = Extract<ReturnType<typeof parseHistoryFilters>, { ok: true }>;
export function historyBaseQuery(filters: ValidHistoryFilters): string {
  const query = new URLSearchParams();
  if (filters.fundId) query.set("fundId", filters.fundId);
  if (filters.status) query.set("status", filters.status);
  if (filters.dateRange.from) query.set("dateFrom", filters.dateRange.from);
  if (filters.dateRange.to) query.set("dateTo", filters.dateRange.to);
  return query.toString();
}
