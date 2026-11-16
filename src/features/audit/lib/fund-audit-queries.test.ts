/** Query construction only; lifecycle-reader tests cover the real auth boundary. */
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ snapshot: vi.fn(), rows: vi.fn(), count: vi.fn() }));
vi.mock("@/features/fund-management/lib/fund-lifecycle-history", () => ({ withChiefFundHistorySnapshot: m.snapshot }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { getChiefFundAuditLogs } from "./audit-queries";
import { parseAuditFilters } from "./audit-filters";
beforeEach(() => {
  vi.resetAllMocks(); m.rows.mockResolvedValue([]); m.count.mockResolvedValue(26);
  m.snapshot.mockImplementation(async (_id, body) => body({ auditLog: { findMany: m.rows, count: m.count } }, { id: "f", name: "Fund" }, "trusted-v"));
});
it("ANDs trusted scope with identical row/count filters and deterministic bounded pagination", async () => {
  const result = await getChiefFundAuditLogs("f", parseAuditFilters({ actionType: "UPDATE", entityType: "FUND_END_DATE_EXTENSION", dateFrom: "2026-11-01", dateTo: "2026-11-01", page: "2" }));
  const query = m.rows.mock.calls[0][0];
  expect(query).toMatchObject({ take: 25, skip: 25, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  expect(query.where).toEqual({ AND: [{ villageId: "trusted-v", fundId: "f" }, { actionType: "UPDATE", entityType: "FUND_END_DATE_EXTENSION", createdAt: { gte: new Date("2026-10-31T17:30Z"), lt: new Date("2026-11-01T17:30Z") } }] });
  expect(m.count).toHaveBeenCalledWith({ where: query.where }); expect(result.totalPages).toBe(2);
});
it.each([{ dateFrom: "2026-02-30" }, { dateFrom: ["2026-01-01", "2026-01-02"] }, { dateFrom: "2026-02-01", dateTo: "2026-01-01" }])("invalid dates never query audit data: %j", async (params) => {
  await expect(getChiefFundAuditLogs("f", parseAuditFilters(params))).rejects.toThrow("Invalid audit date"); expect(m.rows).not.toHaveBeenCalled(); expect(m.count).not.toHaveBeenCalled();
});
it("does not swallow authorization or database failures", async () => {
  const error = new Error("denied"); m.snapshot.mockRejectedValue(error); await expect(getChiefFundAuditLogs("foreign", parseAuditFilters({}))).rejects.toBe(error);
});
