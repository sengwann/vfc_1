import { describe, expect, it } from "vitest";

import { isSerializationConflict } from "./retry";

describe("isSerializationConflict", () => {
  it.each(["40001", "40P01"])("detects raw PostgreSQL %s", (code) => {
    expect(isSerializationConflict({ code })).toBe(true);
    expect(isSerializationConflict(new Error("wrapped", { cause: { code } }))).toBe(true);
    expect(isSerializationConflict({ code: "P2010", meta: { code } })).toBe(true);
    expect(isSerializationConflict({ name: "DriverAdapterError", cause: { originalCode: code } })).toBe(true);
  });

  it.each(["P0001", "23505", "23503", "23514", "08006", "ECONNRESET", "P1001", "P2002"])(
    "does not retry %s, even beneath P2034", (code) => {
      expect(isSerializationConflict({ code })).toBe(false);
      expect(isSerializationConflict({ code: "P2034", cause: { code } })).toBe(false);
    },
  );

  it("does not interpret messages or arbitrary payloads as conflict codes", () => {
    expect(isSerializationConflict(new Error("40001 40P01 TransactionWriteConflict"))).toBe(false);
    expect(isSerializationConflict({ meta: { input: { code: "40001" } } })).toBe(false);
    expect(isSerializationConflict({ kind: "TransactionWriteConflict" })).toBe(false);
  });

  it("detects Prisma 6 P2034", () => {
    expect(isSerializationConflict({ code: "P2034" })).toBe(true);
  });

  it("detects Prisma 7 adapter-pg DriverAdapterError", () => {
    expect(
      isSerializationConflict({
        name: "DriverAdapterError",
        cause: { kind: "TransactionWriteConflict" },
      }),
    ).toBe(true);
  });

  it("detects raw-SQL P2010 with driverAdapterError meta", () => {
    expect(
      isSerializationConflict({
        code: "P2010",
        meta: {
          driverAdapterError: { cause: { kind: "TransactionWriteConflict" } },
        },
      }),
    ).toBe(true);
  });

  it("does not retry unique-constraint violations", () => {
    expect(isSerializationConflict({ code: "P2002" })).toBe(false);
  });

  it("does not retry generic errors or non-objects", () => {
    expect(isSerializationConflict(new Error("boom"))).toBe(false);
    expect(isSerializationConflict(null)).toBe(false);
    expect(isSerializationConflict("P2034")).toBe(false);
  });
});
