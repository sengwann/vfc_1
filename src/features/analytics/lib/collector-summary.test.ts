import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ aggregate: vi.fn(), rows: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { payment: { aggregate: m.aggregate, findMany: m.rows } } }));
import { getCollectorCollectionSummary } from "./collector-analytics";
beforeEach(() => vi.resetAllMocks());
it.each([0, 12345])("uses one scoped aggregate for lifetime totals %i without enumerating payments", async (amount) => {
  m.aggregate.mockResolvedValue({ _sum: { amount: amount || null }, _count: { id: amount ? 12 : 0 } });
  expect(await getCollectorCollectionSummary("v", "collector")).toEqual({ totalCollected: amount, acceptedCount: amount ? 12 : 0 });
  expect(m.aggregate).toHaveBeenCalledExactlyOnceWith({ where: { villageId: "v", collectorUserId: "collector", status: "ACCEPTED" }, _sum: { amount: true }, _count: { id: true } });
  expect(m.rows).not.toHaveBeenCalled();
});
it("propagates aggregate failure", async () => {
  const error = new Error("database"); m.aggregate.mockRejectedValue(error);
  await expect(getCollectorCollectionSummary("v", "collector")).rejects.toBe(error);
});
