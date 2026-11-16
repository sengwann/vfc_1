import { describe, expect, it } from "vitest";
import { encodeHistoryCursor, decodeHistoryCursor } from "./history-cursor";
import { parseHistoryFilters } from "./history-filters";
function filters() {
  const f = parseHistoryFilters({ fundId: "f", dateFrom: "2026-11-15", dateTo: "2026-11-16", status: "VOIDED" });
  if (!f.ok) throw new Error("Invalid fixture"); return f;
}
describe("history cursor binding", () => {
  it("round trips an anchor without carrying authority or trusting a timestamp", () => {
    const f = filters(); const token = encodeHistoryCursor("cash", f, "p");
    expect(decodeHistoryCursor("cash", { ...f, cursor: token })).toBe("p");
    expect(JSON.parse(Buffer.from(token, "base64url").toString())).toEqual({ v: 1, id: "p", binding: expect.any(String) });
    expect(decodeHistoryCursor("receipt", { ...f, cursor: token })).toBeNull();
    for (const modified of [{ ...f, fundId: "other" }, { ...f, status: "ACCEPTED" as const }, { ...f, dateRange: { ...f.dateRange, from: "2026-11-14" } }, { ...f, dateRange: { ...f.dateRange, to: "2026-11-17" } }]) {
      expect(decodeHistoryCursor("cash", { ...modified, cursor: token })).toBeNull();
    }
  });
  it.each(["!", "x".repeat(1025), Buffer.from('{"v":2}').toString("base64url")])("rejects malformed tokens", (cursor) => {
    expect(decodeHistoryCursor("cash", { ...filters(), cursor })).toBeNull();
  });
});
