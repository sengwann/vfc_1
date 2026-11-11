import { describe, expect, it } from "vitest";
import { inspectDatabaseError } from "./database-errors";

describe("inspectDatabaseError", () => {
  it("preserves a raw business SQLSTATE and constraint without reading messages", () => {
    expect(inspectDatabaseError({ code: "P2010", meta: {
      driverAdapterError: { cause: { originalCode: "P0001", constraint: "scope_guard" } },
    } })).toEqual({ sqlStates: ["P0001"], prismaCodes: ["P2010"], constraints: ["scope_guard"], retryable: false });
  });

  it("recognizes nested adapter and raw pg envelopes", () => {
    expect(inspectDatabaseError({ cause: { code: "P2010", meta: {
      driverAdapterError: { cause: { kind: "TransactionWriteConflict", originalCode: "40P01" } },
    } } })).toMatchObject({ sqlStates: ["40P01"], retryable: true });
    expect(inspectDatabaseError({ originalError: { sqlState: "40001" } }).retryable).toBe(true);
  });

  it("terminates on cycles and fails closed on excessively deep envelopes", () => {
    const cycle: { cause?: unknown } = {};
    cycle.cause = cycle;
    expect(inspectDatabaseError(cycle).retryable).toBe(false);
    let deep: unknown = { code: "23505" };
    for (let i = 0; i < 40; i += 1) deep = { cause: deep };
    expect(inspectDatabaseError({ code: "P2034", cause: deep }).retryable).toBe(false);
  });

  it("prefers explicit business/connection failures over generic adapter conflicts", () => {
    for (const code of ["23505", "23514", "08006", "P0001"]) {
      expect(inspectDatabaseError({ name: "DriverAdapterError", cause: {
        kind: "TransactionWriteConflict", originalCode: code,
      } }).retryable).toBe(false);
    }
  });

  it("recognizes a confirmed 40001 within a cyclic cause chain", () => {
    const failure: { code: string; cause?: unknown } = { code: "40001" };
    const wrapper = { cause: failure };
    failure.cause = wrapper;
    expect(inspectDatabaseError(wrapper)).toEqual({
      sqlStates: ["40001"],
      prismaCodes: [],
      constraints: [],
      retryable: true,
    });
  });
});
