import { describe, expect, it, vi } from "vitest";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import type { FinancialTransactionClient } from "@/lib/db/village-scope";
import { beginHouseholdWrite } from "./household-write";
vi.mock("@/lib/auth/session-identity", () => ({ getSessionIdentity: vi.fn() }));
describe("household entry", () => {
  it("acquires scope before guard and locks Users in ID order with current authority checks", async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ userId: "z-actor", sessionVersion: 1 });
    const calls: string[] = [];
    const query = vi.fn(async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const sql = parts.join("?"); calls.push(sql);
      if (sql.includes('FROM "Village"')) return [{ status: "ACTIVE" }];
      if (sql.includes("SELECT EXISTS")) return [{ found: false }];
      if (sql.includes('FROM public."User"')) return [{ id: values[0], villageId: "v", houseId: null, role: "CHIEF", membershipStatus: "ACTIVE", sessionVersion: 1, mustChangePassword: false }];
      return [];
    });
    const tx = { $queryRaw: query, user: { findUnique: vi.fn().mockResolvedValue({ houseId: null, villageId: "v" }) }, fund: { findMany: vi.fn().mockResolvedValue([]) } } as unknown as FinancialTransactionClient;
    await beginHouseholdWrite(tx, { villageId: "v", permission: "chief", actorUserId: "z-actor", targetUserIds: ["a-target"] });
    expect(calls[0]).toContain("vfc_acquire_villages");
    const userCalls = query.mock.calls.filter(([parts]) => parts.join("").includes('FROM public."User"'));
    expect(userCalls.map(([, id]) => id)).toEqual(["a-target", "z-actor"]);
    expect(userCalls.every(([parts]) => parts.join("").includes("FOR NO KEY UPDATE"))).toBe(true);
  });
  it("rejects changed signed identity before any database operation", async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ userId: "other", sessionVersion: 1 });
    const query = vi.fn();
    await expect(beginHouseholdWrite({ $queryRaw: query } as unknown as FinancialTransactionClient,
      { villageId: "v", permission: "chief", actorUserId: "actor" })).rejects.toMatchObject({ code: "VFC_AUTH_SESSION" });
    expect(query).not.toHaveBeenCalled();
  });
});

describe("household authority rejection", () => {
  it.each([
    ["stale session", "chief", { sessionVersion: 2 }, { code: "VFC_AUTH_SESSION" }],
    ["password gate", "chief", { mustChangePassword: true }, { code: "VFC_AUTH_PASSWORD_CHANGE" }],
    ["inactive member", "chief", { membershipStatus: "REMOVED" }, { code: "VFC_AUTH_MEMBERSHIP" }],
    ["demoted Chief", "chief", { role: "VILLAGER" }, { code: "VFC_AUTH_ROLE" }],
    ["revoked village role", "chief", { role: "SYSTEM_ADMIN" }, { code: "VFC_AUTH_ROLE" }],
    ["lost Head", "head", {}, { message: "HOUSEHOLD_ACCESS_CHANGED" }],
    ["active rejoin", "rejoin", {}, { message: "INVALID_REJOIN_STATE" }],
  ] as const)("rejects %s before subsequent work", async (_label, permission, change, expected) => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ userId: "actor", sessionVersion: 1 });
    const actor = { id: "actor", villageId: "v", houseId: "h", role: "CHIEF", membershipStatus: "ACTIVE", sessionVersion: 1, mustChangePassword: false, ...change };
    const query = vi.fn(async (parts: TemplateStringsArray) => {
      const sql = parts.join("");
      if (sql.includes('FROM "Village"')) return [{ status: "ACTIVE" }];
      if (sql.includes("SELECT EXISTS")) return [{ found: false }];
      if (sql.includes('FROM public."House"')) return [{ id: "h", villageId: "v", isActive: true, headOfHouseId: "other" }];
      if (sql.includes('FROM public."User"')) return [actor];
      return [];
    });
    const tx = { $queryRaw: query, user: { findUnique: vi.fn().mockResolvedValue({ houseId: "h", villageId: "v" }), update: vi.fn() }, fund: { findMany: vi.fn().mockResolvedValue([]) }, auditLog: { create: vi.fn() } };
    const subsequentMutation = vi.fn();
    await expect((async () => {
      await beginHouseholdWrite(tx as unknown as FinancialTransactionClient, { villageId: "v", permission, actorUserId: "actor", houseIds: ["h"], deactivateAssignmentsFor: "target" });
      subsequentMutation();
    })()).rejects.toMatchObject(expected);
    expect(subsequentMutation).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([parts]) => parts.join("").includes('CollectorAssignment'))).toBe(false);
  });
});
