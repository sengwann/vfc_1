import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { validateFundExtension } from "./fund-extension-validators";
import { FundWriteError } from "./fund-write";
function form(date: unknown, reason: unknown = " Unpaid houses ") {
  const data = new FormData();
  if (date !== null) data.set("newEndDate", date as string);
  if (reason !== null) data.set("reason", reason as string);
  return data;
}
describe("extension calendar input", () => {
  it("preserves the calendar label independently of server timezone", () => {
    expect(validateFundExtension(form("2028-02-29"))).toEqual({ newEndDate: new Date("2028-02-29T00:00:00Z"), reason: "Unpaid houses" });
  });
  it.each([null, "", "2026-02-29", "2026-13-01", "2026-04-31", "0000-01-01", "2026-01-01T00:00Z", " 2026-01-01"])("rejects date %s", (date) => {
    expect(() => validateFundExtension(form(date))).toThrow(new FundWriteError("New end date is invalid."));
  });
  it.each([null, "", "  ", "bad\0reason"])("rejects reason %s", (reason) => {
    expect(() => validateFundExtension(form("2026-01-01", reason))).toThrow("Extension reason is required.");
  });
});
