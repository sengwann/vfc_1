import { describe, expect, it } from "vitest";
import { parseHistoryFilters, historyBaseQuery } from "./history-filters";
describe("history filters", () => {
  it("defaults to all statuses and retains normalized Yangon payment dates", () => {
    const f = parseHistoryFilters({ fundId: "closed-fund", dateFrom: "2026-11-15", dateTo: "2026-11-15" });
    expect(f).toMatchObject({ ok: true, status: "", dateRange: { gte: new Date("2026-11-14T17:30Z"), lt: new Date("2026-11-15T17:30Z") } });
    if (!f.ok) throw new Error("Invalid fixture");
    expect(historyBaseQuery(f)).toBe("fundId=closed-fund&dateFrom=2026-11-15&dateTo=2026-11-15");
    expect(historyBaseQuery(f)).not.toContain("cursor");
  });
  it.each(["fundId", "status", "dateFrom", "dateTo", "cursor", "direction"])("rejects repeated %s", (key) => {
    expect(parseHistoryFilters({ [key]: ["x", "x"] })).toMatchObject({ ok: false, error: "REPEATED" });
  });
  it.each([{ status: "ACTIVE" }, { dateFrom: "2026-02-30" }, { dateFrom: "2026-01-01T00:00Z" }, { dateFrom: "2026-02-02", dateTo: "2026-02-01" }, { cursor: "x" }, { direction: "older" }, { fundId: " bad" }])("rejects invalid filters %j", (params) => {
    expect(parseHistoryFilters(params).ok).toBe(false);
  });
});
