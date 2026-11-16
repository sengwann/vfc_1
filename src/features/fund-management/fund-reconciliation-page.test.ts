/** Page wiring only; no database or browser execution. */
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ chief: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireChief: m.chief }));
vi.mock("@/features/fund-management/lib/fund-reconciliation-queries", () => ({ getChiefFundReconciliation: m.read }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("unavailable"); } }));
import Page from "@/app/(village)/village/funds/[fundId]/reconciliation/page";
beforeEach(() => {
  vi.resetAllMocks(); m.chief.mockResolvedValue({ villageId: "v" }); m.read.mockResolvedValue({ fund: { id: "f", name: "Fund", termsVersion: 2 }, clean: false, metrics: null,
    checks: { assessments: "PASS", payments: "PASS", receipts: "PASS", lifecycle: "PASS", audit: "DISCREPANCY" }, findings: Array.from({ length: 201 }, (_, i) => ({ category: "audit", outcome: "DISCREPANCY", code: "AUDIT_MISSING", recordId: String(i) })) });
});
it("paginates findings only after the full reader, passing no display/user scope to it", async () => {
  const page = await Page({ params: Promise.resolve({ fundId: "f" }), searchParams: { page: "2", villageId: "foreign", userId: "other" } });
  expect(m.read).toHaveBeenCalledWith("f"); expect(page.props.result.findings).toHaveLength(100); expect(page.props.result.findings[0].recordId).toBe("100"); expect(page.props.totalFindings).toBe(201); expect(page.props.result.clean).toBe(false);
});
it("denies preflight and propagates unexpected reader errors", async () => {
  m.chief.mockRejectedValueOnce(new Error("denied")); await expect(Page({ params: { fundId: "f" } })).rejects.toThrow("denied"); expect(m.read).not.toHaveBeenCalled();
  const error = new Error("database"); m.read.mockRejectedValue(error); await expect(Page({ params: { fundId: "f" } })).rejects.toBe(error);
});
it.each(["0", "NaN", ["1", "2"]])("rejects malformed or repeated display pages: %j", async (page) => {
  await expect(Page({ params: { fundId: "f" }, searchParams: { page } })).rejects.toThrow("unavailable"); expect(m.read).not.toHaveBeenCalled();
});
