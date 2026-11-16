/** Query contracts only; real PostgreSQL timestamp mapping is a later gate. */
import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ rows: vi.fn(), count: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { auditLog: { findMany: db.rows, count: db.count } } }));
import { parseAuditFilters, type SearchParams } from "./audit-filters";
import { getChiefAuditLogs, getPlatformAuditLogs } from "./audit-queries";

beforeEach(() => { vi.resetAllMocks(); db.rows.mockResolvedValue([]); db.count.mockResolvedValue(51); });
describe("audit date query contracts", () => {
  for (const target of ["chief", "platform"] as const) {
    const read = (params: Parameters<typeof parseAuditFilters>[0]) => {
      const filters = parseAuditFilters(params);
      return target === "chief" ? getChiefAuditLogs({ villageId: "trusted-village", filters }) : getPlatformAuditLogs({ filters });
    };
    it(`${target} uses identical half-open bounds for rows/count and preserves scope, filters and page`, async () => {
      const result = await read({ actionType: "CREATE", entityType: "VILLAGE", dateFrom: "2026-11-15", dateTo: "2026-11-15", page: "2" });
      const expected = { ...(target === "chief" ? { villageId: "trusted-village" } : {}), actionType: "CREATE", entityType: "VILLAGE",
        createdAt: { gte: new Date("2026-11-14T17:30:00Z"), lt: new Date("2026-11-15T17:30:00Z") } };
      expect(db.rows.mock.calls[0][0]).toMatchObject({ where: expected, skip: 25, take: 25 });
      expect(db.count).toHaveBeenCalledWith({ where: expected });
      expect(db.rows.mock.calls[0][0].where).toBe(db.count.mock.calls[0][0].where);
      expect(result.totalPages).toBe(3);
    });
    it.each([{ dateFrom: "bad" }, { dateTo: "2026-02-30" }, { dateFrom: "2026-02-02", dateTo: "2026-02-01" }, { dateFrom: ["2026-01-01", "2026-01-01"] }])(`${target} refuses invalid bounds before either database query: %j`, async (params) => {
      await expect(read(params)).rejects.toThrow("Invalid audit date range.");
      expect(db.rows).not.toHaveBeenCalled(); expect(db.count).not.toHaveBeenCalled();
    });
    const optionalBounds: [SearchParams, { gte?: Date; lt?: Date } | undefined][] = [
      [{}, undefined],
      [{ dateFrom: "2026-11-15" }, { gte: new Date("2026-11-14T17:30:00Z") }],
      [{ dateTo: "2026-11-15" }, { lt: new Date("2026-11-15T17:30:00Z") }],
    ];
    it.each(optionalBounds)(`${target} supports optional bounds %j`, async (params, expected) => {
      await read(params);
      expect(db.rows.mock.calls[0][0].where.createdAt).toEqual(expected);
      expect(db.count.mock.calls[0][0].where.createdAt).toEqual(expected);
      expect(db.rows.mock.calls[0][0].where).toMatchObject(target === "chief" ? { villageId: "trusted-village" } : { entityType: "VILLAGE" });
    });
  }
});
