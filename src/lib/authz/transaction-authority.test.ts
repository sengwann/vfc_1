import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionIdentity } from "../auth/session-identity";
import { acquireVillageScopes } from "../db/village-scope";
import { guardVillageWrite } from "./village-write-guard";
import { authorizeFinancialTransaction } from "./transaction-authority";
import type { FinancialTransactionClient } from "../db/village-scope";
vi.mock("../auth/session-identity", () => ({ getSessionIdentity: vi.fn() }));
vi.mock("../db/village-scope", async (original) => ({ ...await original<typeof import("../db/village-scope")>(), acquireVillageScopes: vi.fn() }));
vi.mock("./village-write-guard", () => ({ guardVillageWrite: vi.fn() }));

const actor = { id: "actor", role: "VILLAGER", villageId: "v", houseId: "h", membershipStatus: "ACTIVE", sessionVersion: 3, mustChangePassword: false };
function transaction(overrides = {}, assignment = true, at = "2026-01-31T17:30:00Z") {
  const query = vi.fn().mockResolvedValueOnce([{ ...actor, ...overrides }])
    .mockResolvedValueOnce([{ now: new Date(at) }]).mockResolvedValueOnce(assignment ? [{ id: "assignment" }] : []);
  return { tx: { $queryRaw: query } as unknown as FinancialTransactionClient, query };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSessionIdentity).mockResolvedValue({ userId: "actor", sessionVersion: 3 });
  vi.mocked(guardVillageWrite).mockResolvedValue({ ok: true });
});
describe("transactional financial authority", () => {
  it.each([
    [{ membershipStatus: "REMOVED" }, true, "VFC_AUTH_MEMBERSHIP"],
    [{ villageId: "other" }, true, "VFC_AUTH_VILLAGE"],
    [{ sessionVersion: 4 }, true, "VFC_AUTH_SESSION"],
    [{ mustChangePassword: true }, true, "VFC_AUTH_PASSWORD_CHANGE"],
    [{ role: "SYSTEM_ADMIN" }, true, "VFC_AUTH_ROLE"],
    [{ role: "CHIEF" }, false, "VFC_AUTH_COLLECTOR"],
    [{}, false, "VFC_AUTH_COLLECTOR"],
  ] as const)("rejects revoked or stale authority %j", async (overrides, assigned, code) => {
    const { tx } = transaction(overrides, assigned);
    await expect(authorizeFinancialTransaction(tx, { villageId: "v", permission: "collector" })).rejects.toMatchObject({ code });
  });
  it("rejects a stale Chief role using the database role", async () => {
    const { tx } = transaction();
    await expect(authorizeFinancialTransaction(tx, { villageId: "v", permission: "chief" })).rejects.toMatchObject({ code: "VFC_AUTH_ROLE" });
  });
  it.each([
    ["2026-01-31T17:29:59.999Z", 2026, 1],
    ["2026-01-31T17:30:00.000Z", 2026, 2],
    ["2026-12-31T17:30:00.000Z", 2027, 1],
  ])("uses Yangon collector period at %s", async (at, year, month) => {
    const { tx, query } = transaction({}, true, at as string);
    const result = await authorizeFinancialTransaction(tx, { villageId: "v", permission: "collector" });
    expect(result.assignmentId).toBe("assignment");
    expect(query.mock.calls[2].slice(1)).toEqual(["actor", "v", year, month]);
    expect(vi.mocked(acquireVillageScopes).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(guardVillageWrite).mock.invocationCallOrder[0]);
    expect(vi.mocked(guardVillageWrite).mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[0]);
  });
  it.each(["VILLAGE_INACTIVE", "VILLAGE_READ_ONLY"] as const)("propagates %s before entity or authority reads", async (reason) => {
    vi.mocked(guardVillageWrite).mockResolvedValue({ ok: false, reason });
    const { tx, query } = transaction();
    await expect(authorizeFinancialTransaction(tx, { villageId: "v", permission: "chief" })).rejects.toMatchObject({ code: reason });
    expect(query).not.toHaveBeenCalled();
  });
  it("locks Fund then House then the authoritative User", async () => {
    const query = vi.fn().mockResolvedValueOnce([{ id: "f", villageId: "v", status: "DRAFT", termsVersion: 1 }])
      .mockResolvedValueOnce([{ id: "h", villageId: "v", isActive: true, headOfHouseId: "actor" }])
      .mockResolvedValueOnce([{ ...actor, role: "CHIEF" }]);
    await authorizeFinancialTransaction({ $queryRaw: query } as unknown as FinancialTransactionClient,
      { villageId: "v", permission: "chief", fundIds: ["f"], houseIds: ["h"] });
    expect(query.mock.calls.map(([sql]) => sql.join("?"))).toEqual([
      expect.stringContaining('FROM public."Fund"'), expect.stringContaining('FROM public."House"'), expect.stringContaining('FROM public."User"'),
    ]);
    expect(query.mock.calls[1][0].join("")).toContain("FOR NO KEY UPDATE");
    expect(query.mock.calls[2][0].join("")).toContain("FOR SHARE");
  });
  it("rejects an absent verified session before SQL", async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue(null);
    const { tx, query } = transaction();
    await expect(authorizeFinancialTransaction(tx, { villageId: "v", permission: "member" })).rejects.toMatchObject({ code: "VFC_AUTH_SESSION" });
    expect(query).not.toHaveBeenCalled(); expect(acquireVillageScopes).not.toHaveBeenCalled();
  });
});
