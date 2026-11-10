import { describe, expect, it, vi } from "vitest";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import type { FinancialTransactionClient } from "@/lib/db/village-scope";
import { hasLifecycleAuthority } from "./lifecycle-authority";
vi.mock("@/lib/auth/session-identity", () => ({ getSessionIdentity: vi.fn() }));
describe("lifecycle authority", () => {
  it.each([
    [{}, true], [{ sessionVersion: 2 }, false], [{ mustChangePassword: true }, false],
    [{ role: "VILLAGER" }, false], [{ membershipStatus: "REMOVED" }, false], [{ villageId: "other" }, false],
  ] as const)("checks locked current Chief authority: %j", async (change, expected) => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ userId: "actor", sessionVersion: 1 });
    const query = vi.fn().mockResolvedValue([{ role: "CHIEF", villageId: "v", membershipStatus: "ACTIVE", sessionVersion: 1, mustChangePassword: false, ...change }]);
    expect(await hasLifecycleAuthority({ $queryRaw: query } as unknown as FinancialTransactionClient, "actor", "CHIEF", "v")).toBe(expected);
    expect(query.mock.calls[0][0].join("")).toContain("FOR SHARE");
  });
  it("rejects a server identity that does not match verified claims before reading rows", async () => {
    vi.mocked(getSessionIdentity).mockResolvedValue({ userId: "other", sessionVersion: 1 });
    const query = vi.fn();
    expect(await hasLifecycleAuthority({ $queryRaw: query } as unknown as FinancialTransactionClient, "actor", "SYSTEM_ADMIN")).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
