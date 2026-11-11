import { describe, expect, it, vi } from "vitest";
import { lockFunds, lockHouses } from "./financial-locks";
import type { FinancialTransactionClient } from "./village-scope";

describe.each([
  ["Fund", lockFunds, "FOR UPDATE"],
  ["House", lockHouses, "FOR NO KEY UPDATE"],
] as const)("ordered %s locks", (_entity, lock, mode) => {
  it("sorts/deduplicates globally, binds tenant IDs and retains the lock mode", async () => {
    const query = vi.fn(async (_sql: TemplateStringsArray, id: string, villageId: string) => [{ id, villageId }]);
    const tx = { $queryRaw: query } as unknown as FinancialTransactionClient;
    const targets = [{ id: "z", villageId: "a" }, { id: "a", villageId: "z" }, { id: "a", villageId: "z" }];
    expect(await lock(tx, targets)).toEqual([{ id: "a", villageId: "z" }, { id: "z", villageId: "a" }]);
    expect(query.mock.calls.map((call) => call.slice(1))).toEqual([["a", "z"], ["z", "a"]]);
    for (const [sql] of query.mock.calls) {
      expect(sql.join("?")).toContain('"id" = ? AND "villageId" = ?');
      expect(sql.join("")).toContain(mode);
    }
    expect(targets[0].id).toBe("z");
  });

  it("fails closed for a missing or other-Village entity", async () => {
    const tx = { $queryRaw: vi.fn().mockResolvedValue([]) } as unknown as FinancialTransactionClient;
    await expect(lock(tx, [{ id: "other", villageId: "v" }])).rejects.toMatchObject({ code: "VFC_LOCK_TARGET_NOT_FOUND" });
  });

  it("rejects conflicting tenants and blank IDs before any SQL", async () => {
    const query = vi.fn();
    const tx = { $queryRaw: query } as unknown as FinancialTransactionClient;
    await expect(lock(tx, [{ id: "a", villageId: "v" }, { id: "a", villageId: "other" }])).rejects.toThrow("different Villages");
    await expect(lock(tx, [{ id: " ", villageId: "v" }])).rejects.toThrow("nonempty");
    expect(query).not.toHaveBeenCalled();
    expect(await lock(tx, [])).toEqual([]);
  });

  it("rejects root clients before issuing locks", async () => {
    const query = vi.fn();
    await expect(lock({ $queryRaw: query, $transaction: vi.fn() } as unknown as FinancialTransactionClient, [])).rejects.toThrow("interactive transaction client");
    expect(query).not.toHaveBeenCalled();
  });
});
