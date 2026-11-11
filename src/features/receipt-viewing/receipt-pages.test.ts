/** Actual routes, access helper and rendered components. Authenticated identity,
 * Collector lookup, database queries and framework navigation are boundaries. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/auth/auth.types";
const mocks = vi.hoisted(() => ({ user: vi.fn(), collector: vi.fn(), list: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ requireAuthenticatedUser: mocks.user }));
vi.mock("@/lib/authz", () => ({ getActiveCollectorContext: mocks.collector }));
vi.mock("@/lib/prisma", () => ({ prisma: { receipt: { findMany: mocks.list, findUnique: mocks.detail } } }));
vi.mock("next/navigation", () => ({ notFound: () => { throw Object.assign(new Error("not found"), { digest: "TEST_NOT_FOUND" }); }, redirect: (path: string) => { throw Object.assign(new Error("navigation"), { path }); } }));
import ReceiptsPage from "@/app/(village)/village/receipts/page";
import ReceiptDetailPage from "@/app/(village)/village/receipts/[receiptId]/page";
import { TranslationProvider } from "@/lib/i18n/provider";
const actor: SessionUser = { id: "member", villageId: "v", houseId: "h", role: "VILLAGER", membershipStatus: "ACTIVE", name: "Member", email: null, phone: null, dateOfBirth: null, mustChangePassword: false };
function receipt() { return { id: "receipt-old", receiptNumber: "VFC-ORIGINAL-0001", villageId: "v", status: "VOIDED", createdAt: new Date("2026-01-01"), payment: {
  id: "payment-old", amount: 1001, voidReason: "Incorrect payer recorded", createdAt: new Date("2026-01-01"),
  collectorUserId: "collector", payerUserId: "member", fund: { name: "Fund" },
  assessment: { houseNumberSnapshot: "FROZEN-H1" }, house: { houseNumber: "LIVE-H99" },
  payer: { name: "Member" }, collector: { name: "Collector" },
} }; }
function render(element: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(createElement(TranslationProvider, { language: "EN", children: element }));
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.user.mockResolvedValue(actor); mocks.collector.mockResolvedValue(null);
  mocks.detail.mockResolvedValue(receipt()); mocks.list.mockResolvedValue([receipt(), { ...receipt(), id: "receipt-new", receiptNumber: "VFC-NEW-0002", status: "ACTIVE" }]);
});
describe("receipt readers and existing permissions", () => {
  it("retains ACTIVE/VOIDED history, identity and numbers without a status filter", async () => {
    const html = render(await ReceiptsPage());
    expect(html).toContain("VFC-ORIGINAL-0001"); expect(html).toContain("VFC-NEW-0002");
    expect(html).toContain("receipt-old"); expect(html).toContain("receipt-new");
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ where: { villageId: "v", payment: { payerUserId: "member" } } }));
  });
  it.each(["chief", "collector", "own"] as const)("uses the existing %s list restrictions", async (kind) => {
    if (kind === "chief") mocks.user.mockResolvedValue({ ...actor, role: "CHIEF" });
    if (kind === "collector") mocks.collector.mockResolvedValue({ user: actor, villageId: "v" });
    await ReceiptsPage();
    const where = kind === "chief" ? { villageId: "v" } : kind === "collector" ? { villageId: "v", OR: [{ payment: { collectorUserId: "member" } }, { payment: { payerUserId: "member" } }] } : { villageId: "v", payment: { payerUserId: "member" } };
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ where }));
  });
  it("renders frozen detail identity, void reason and original receipt number", async () => {
    const html = render(await ReceiptDetailPage({ params: Promise.resolve({ receiptId: "receipt-old" }) }));
    expect(html).toContain("FROZEN-H1"); expect(html).not.toContain("LIVE-H99");
    expect(html).toContain("VFC-ORIGINAL-0001"); expect(html).toContain("Incorrect payer recorded"); expect(html).toContain("1,001");
    expect(mocks.detail).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "receipt-old" }, select: expect.objectContaining({ payment: { select: expect.objectContaining({ assessment: { select: { houseNumberSnapshot: true } } }) } }) }));
  });
  it.each(["own", "collector", "chief"] as const)("rejects a foreign-Village receipt for %s", async (kind) => {
    if (kind === "chief") mocks.user.mockResolvedValue({ ...actor, role: "CHIEF" });
    if (kind === "collector") mocks.collector.mockResolvedValue({ user: actor, villageId: "v" });
    mocks.detail.mockResolvedValue({ ...receipt(), villageId: "foreign" });
    await expect(ReceiptDetailPage({ params: { receiptId: "receipt-old" } })).rejects.toMatchObject({ digest: "TEST_NOT_FOUND" });
  });
  it("rejects another member's receipt", async () => {
    const value = receipt(); value.payment.payerUserId = "someone-else"; mocks.detail.mockResolvedValue(value);
    await expect(ReceiptDetailPage({ params: { receiptId: "receipt-old" } })).rejects.toMatchObject({ digest: "TEST_NOT_FOUND" });
  });
  it.each(["collected", "own", "unrelated"] as const)("Collector detail access: %s", async (kind) => {
    mocks.collector.mockResolvedValue({ user: actor, villageId: "v" });
    const value = receipt(); value.payment.payerUserId = kind === "own" ? "member" : "another";
    value.payment.collectorUserId = kind === "collected" ? "member" : "other-collector"; mocks.detail.mockResolvedValue(value);
    const pending = ReceiptDetailPage({ params: { receiptId: "receipt-old" } });
    if (kind === "unrelated") await expect(pending).rejects.toMatchObject({ digest: "TEST_NOT_FOUND" });
    else expect(render(await pending)).toContain("VFC-ORIGINAL-0001");
  });
  it("Chief can view another member's receipt within the same Village", async () => {
    mocks.user.mockResolvedValue({ ...actor, role: "CHIEF" });
    const value = receipt(); value.payment.payerUserId = "another"; mocks.detail.mockResolvedValue(value);
    expect(render(await ReceiptDetailPage({ params: { receiptId: "receipt-old" } }))).toContain("VFC-ORIGINAL-0001");
  });
  it("rejects inactive membership before receipt reads", async () => {
    mocks.user.mockResolvedValue({ ...actor, membershipStatus: "REMOVED" });
    await expect(ReceiptsPage()).rejects.toMatchObject({ path: "/forbidden" });
    await expect(ReceiptDetailPage({ params: { receiptId: "receipt-old" } })).rejects.toMatchObject({ path: "/forbidden" });
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.detail).not.toHaveBeenCalled();
  });
});
