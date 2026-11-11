import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const actor = { id: "actor", villageId: "v", houseId: "h", role: "CHIEF", membershipStatus: "ACTIVE", sessionVersion: 1, mustChangePassword: false };
  const tx = {
    $queryRaw: vi.fn(),
    fund: { findMany: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    house: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
  return { actor, tx, transaction: vi.fn(), identity: vi.fn(), redirect: vi.fn(), audit: vi.fn() };
});
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/authz", () => ({ requireChief: async () => ({ user: { id: "actor" }, villageId: "v" }) }));
vi.mock("@/lib/auth/session-identity", () => ({ getSessionIdentity: mocks.identity }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("@/lib/audit", () => ({ AuditEntityType: { HOUSE: "HOUSE" }, createAuditLog: mocks.audit }));
import { deactivateHouseAction } from "./deactivate-house.action";
import { reactivateHouseAction } from "./reactivate-house.action";

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.actor, { role: "CHIEF", membershipStatus: "ACTIVE", sessionVersion: 1, mustChangePassword: false });
  mocks.identity.mockResolvedValue({ userId: "actor", sessionVersion: 1 });
  mocks.tx.user.findUnique.mockResolvedValue({ houseId: "h", villageId: "v" });
  mocks.tx.fund.findMany.mockResolvedValue([]);
  mocks.tx.$queryRaw.mockImplementation(async (parts: TemplateStringsArray) => {
    const sql = parts.join("");
    if (sql.includes('FROM "Village"')) return [{ status: "ACTIVE" }];
    if (sql.includes("SELECT EXISTS")) return [{ found: false }];
    if (sql.includes('FROM public."House"')) return [{ id: "h", villageId: "v", isActive: true, headOfHouseId: "actor" }];
    if (sql.includes('FROM public."User"')) return [mocks.actor];
    return [];
  });
  mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx));
  mocks.redirect.mockImplementation((path: string) => { throw Object.assign(new Error("navigation"), { destination: path }); });
});

for (const [name, action] of [["deactivate", deactivateHouseAction], ["reactivate", reactivateHouseAction]] as const) {
  describe(`${name} transactional authority`, () => {
    it.each([
      ["revoked session", { sessionVersion: 2 }, "/login"],
      ["forced password change", { mustChangePassword: true }, "/change-password"],
      ["inactive membership", { membershipStatus: "REMOVED" }, "/forbidden"],
      ["revoked Chief role", { role: "VILLAGER" }, "/forbidden"],
    ] as const)("maps %s without writes or retries", async (_name, change, destination) => {
      Object.assign(mocks.actor, change);
      await expect(action("h")).rejects.toMatchObject({ destination });
      expect(mocks.redirect).toHaveBeenCalledTimes(1);
      expect(mocks.redirect).toHaveBeenCalledWith(destination);
      expect(mocks.transaction).toHaveBeenCalledTimes(1);
      expect(mocks.tx.house.update).not.toHaveBeenCalled();
      expect(mocks.tx.house.updateMany).not.toHaveBeenCalled();
      expect(mocks.tx.user.update).not.toHaveBeenCalled();
      expect(mocks.tx.auditLog.create).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    });
    it.each([new Error("unexpected"), Object.assign(new Error("navigation signal"), { digest: "NEXT_REDIRECT;replace;/login;307;" })])("propagates unexpected errors and navigation signals unchanged", async (failure) => {
      mocks.tx.$queryRaw.mockRejectedValue(failure);
      await expect(action("h")).rejects.toBe(failure);
      expect(mocks.transaction).toHaveBeenCalledTimes(1);
      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    });
  });
}
