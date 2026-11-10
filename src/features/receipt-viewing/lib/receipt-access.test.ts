/** Real access helper; authenticated identity and Collector lookup are boundaries. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/auth.types";
const mocks = vi.hoisted(() => ({ user: vi.fn(), collector: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ requireAuthenticatedUser: mocks.user }));
vi.mock("@/lib/authz", () => ({ getActiveCollectorContext: mocks.collector }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw Object.assign(new Error("navigation"), { path }); } }));
import { requireReceiptAccess } from "./receipt-access";
const user: SessionUser = { id: "member", villageId: "v", houseId: "h", role: "VILLAGER", membershipStatus: "ACTIVE", name: "Member", email: null, phone: null, dateOfBirth: null, mustChangePassword: false };
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue(user); mocks.collector.mockResolvedValue(null); });
describe("existing receipt access policy", () => {
  it("grants an active Chief village access", async () => {
    mocks.user.mockResolvedValue({ ...user, role: "CHIEF" });
    expect(await requireReceiptAccess()).toMatchObject({ villageId: "v", accessLevel: "village" });
    expect(mocks.collector).not.toHaveBeenCalled();
  });
  it("grants active Collector collected/own access", async () => {
    mocks.collector.mockResolvedValue({ user, villageId: "v" });
    expect(await requireReceiptAccess()).toMatchObject({ user, villageId: "v", accessLevel: "collector" });
    expect(mocks.collector).toHaveBeenCalledWith(user);
  });
  it("limits ordinary active members to own receipts", async () => {
    expect(await requireReceiptAccess()).toMatchObject({ accessLevel: "own" });
  });
  it.each(["CHIEF", "VILLAGER"] as const)("rejects inactive %s", async (role) => {
    mocks.user.mockResolvedValue({ ...user, role, membershipStatus: "REMOVED" });
    await expect(requireReceiptAccess()).rejects.toMatchObject({ path: "/forbidden" });
  });
  it.each([{ ...user, villageId: null }, { ...user, role: "SYSTEM_ADMIN" }])("rejects accounts without permitted village authority", async (actor) => {
    mocks.user.mockResolvedValue(actor);
    await expect(requireReceiptAccess()).rejects.toMatchObject({ path: "/forbidden" });
  });
  // This helper derives the tenant; per-receipt wrong-Village/ownership rejection
  // is exercised through the actual routes in receipt-pages.test.ts.
});
