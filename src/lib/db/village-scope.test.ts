import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  acquireVillageScopes,
  orderedVillageIds,
  type FinancialTransactionClient,
} from "./village-scope";

describe("acquireVillageScopes", () => {
  it("passes every sorted, deduplicated scope in ONE parameterized call", async () => {
    const query = vi.fn().mockResolvedValue([]);
    const tx = { $queryRaw: query } as unknown as FinancialTransactionClient;
    const ids = ["z", "a'quoted", "z", "b"];
    await acquireVillageScopes(tx, ids);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0];
    expect(sql.join("?")).toContain("public.vfc_acquire_villages(?::text[])");
    expect(values).toEqual(["a'quoted", "b", "z"]);
    expect(sql.join("")).not.toContain("a'quoted");
    expect(ids).toEqual(["z", "a'quoted", "z", "b"]);
    expect(orderedVillageIds(ids)).toEqual(["a'quoted", "b", "z"]);
  });

  it.each([
    { ids: [], error: RangeError },
    { ids: [""], error: TypeError },
    { ids: [" "], error: TypeError },
  ])(
    "rejects missing/empty scopes before SQL: $ids",
    async ({ ids, error }) => {
      const query = vi.fn();
      await expect(
        acquireVillageScopes(
          { $queryRaw: query } as unknown as FinancialTransactionClient,
          ids,
        ),
      ).rejects.toBeInstanceOf(error);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each([
    { label: "string", value: "valid" },
    { label: "array-like object", value: { 0: "valid", length: 1 } },
    { label: "top-level null", value: null },
    { label: "top-level undefined", value: undefined },
  ])(
    "rejects a $label container before any database call",
    async ({ value }) => {
      const query = vi.fn();
      const tx = { $queryRaw: query } as unknown as FinancialTransactionClient;
      const input = value as unknown as readonly string[];
      expect(() => orderedVillageIds(input)).toThrow(TypeError);
      await expect(acquireVillageScopes(tx, input)).rejects.toBeInstanceOf(
        TypeError,
      );
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("rejects a non-array before reading its length or indexed properties", async () => {
    const lengthRead = vi.fn(() => 1);
    const indexRead = vi.fn(() => "valid");
    const value = Object.defineProperties(
      {},
      {
        length: { get: lengthRead },
        0: { get: indexRead },
      },
    );
    const query = vi.fn();
    const tx = { $queryRaw: query } as unknown as FinancialTransactionClient;
    await expect(
      acquireVillageScopes(tx, value as unknown as readonly string[]),
    ).rejects.toBeInstanceOf(TypeError);
    expect(lengthRead).not.toHaveBeenCalled();
    expect(indexRead).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a root client at runtime", async () => {
    const query = vi.fn();
    const root = {
      $transaction: vi.fn(),
      $connect: vi.fn(),
      $disconnect: vi.fn(),
      $queryRaw: query,
    };

    await expect(
      acquireVillageScopes(root as unknown as FinancialTransactionClient, [
        "v",
      ]),
    ).rejects.toThrow("interactive transaction client");

    expect(query).not.toHaveBeenCalled();
  });

  const mixedHoles = new Array<string>(2);
  mixedHoles[0] = "valid";

  it.each([
    { label: "all-hole array", ids: new Array<string>(2) },
    { label: "mixed valid/hole array", ids: mixedHoles },
    { label: "undefined", ids: ["valid", undefined] },
    { label: "null", ids: ["valid", null] },
    { label: "number", ids: ["valid", 123] },
    { label: "boolean", ids: ["valid", false] },
    { label: "object", ids: ["valid", { id: "other" }] },
    { label: "empty string", ids: ["valid", ""] },
    { label: "whitespace", ids: ["valid", " \t\n"] },
    { label: "NUL character", ids: ["valid", "bad\0id"] },
  ])("rejects $label before any database call", async ({ ids }) => {
    const query = vi.fn();
    const tx = { $queryRaw: query } as unknown as FinancialTransactionClient;
    // Exercise the runtime boundary; invalid values intentionally violate the
    // public readonly string[] type without weakening that API.
    const input = ids as unknown as readonly string[];
    expect(() => orderedVillageIds(input)).toThrow(TypeError);
    await expect(acquireVillageScopes(tx, input)).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it("propagates missing-scope errors unchanged", async () => {
    const failure = { code: "P0001", message: "VFC_SCOPE_MISSING" };
    const tx = {
      $queryRaw: vi.fn().mockRejectedValue(failure),
    } as unknown as FinancialTransactionClient;
    await expect(acquireVillageScopes(tx, ["missing"])).rejects.toBe(failure);
  });
});
