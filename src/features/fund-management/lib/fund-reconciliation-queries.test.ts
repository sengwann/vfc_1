/** Real snapshot wrapper/reader, mocked Prisma/auth only. No PostgreSQL verification. */
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ chief: vi.fn(), identity: vi.fn(), actor: vi.fn(), fund: vi.fn(), tx: vi.fn(), readOnly: vi.fn(), assessments: vi.fn(), payments: vi.fn(), receipts: vi.fn(), extensions: vi.fn(), audits: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireChief: m.chief }));
vi.mock("@/lib/auth/session-identity", () => ({ getSessionIdentity: m.identity }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.tx } }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(path); }, notFound: () => { throw new Error("unavailable"); } }));
import { getChiefFundReconciliation, RECONCILIATION_CAP } from "./fund-reconciliation-queries";
beforeEach(() => {
  vi.resetAllMocks(); m.chief.mockResolvedValue({ villageId: "v", user: { id: "chief" } }); m.identity.mockResolvedValue({ userId: "chief", sessionVersion: 1 });
  m.actor.mockResolvedValue({ role: "CHIEF", membershipStatus: "ACTIVE", villageId: "v", village: { status: "ACTIVE" }, sessionVersion: 1, mustChangePassword: false });
  m.fund.mockResolvedValue({ id: "f", name: "Fund", villageId: "v", status: "DRAFT", villageTargetAmount: 1001, termsVersion: 1, eligibleHouseCount: null, assessmentPerHouse: null, snapshotAt: null, endDate: new Date("2026-11-30"), closedAt: null, closedByUserId: null });
  for (const mock of [m.assessments, m.payments, m.receipts, m.extensions]) mock.mockResolvedValue([]);
  m.audits.mockResolvedValue([{ id: "log", fundId: "f", villageId: "v", entityId: "f", entityType: "FUND", actionType: "CREATE", actorUserId: "chief", metadata: { event: "DRAFT_CREATED", termsVersion: 1, villageTargetAmount: 1001 } }]);
  m.tx.mockImplementation(async (body) => body({ $executeRaw: m.readOnly, user: { findUnique: m.actor }, fund: { findFirst: m.fund }, fundHouseAssessment: { findMany: m.assessments }, payment: { findMany: m.payments }, receipt: { findMany: m.receipts }, fundEndDateExtension: { findMany: m.extensions }, auditLog: { findMany: m.audits } }));
});
it("uses the authorized read-only snapshot and five bounded batch reads", async () => {
  expect((await getChiefFundReconciliation("f")).clean).toBe(true);
  expect(m.tx.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead", maxWait: 2000, timeout: 5000 });
  expect(m.readOnly.mock.calls[0][0].join("")).toBe("SET TRANSACTION READ ONLY"); expect(m.readOnly.mock.invocationCallOrder[0]).toBeLessThan(m.actor.mock.invocationCallOrder[0]);
  for (const mock of [m.assessments, m.payments, m.receipts, m.extensions, m.audits]) { expect(mock).toHaveBeenCalledTimes(1); expect(mock.mock.calls[0][0]).toMatchObject({ take: 10001, orderBy: { id: "asc" } }); }
  expect(m.payments.mock.calls[0][0].where).toEqual({ fundId: "f", villageId: "v" }); expect(m.assessments.mock.calls[0][0].where).toEqual({ fundId: "f", villageId: "v" });
  expect(m.audits.mock.calls[0][0].where).toMatchObject({ villageId: "v", OR: [{ fundId: "f" }, { entityType: "FUND", entityId: "f" }, { entityType: "FUND_HOUSE_ASSESSMENT", entityId: { in: [] } }, { entityType: "PAYMENT", entityId: { in: [] } }, { entityType: "RECEIPT", entityId: { in: [] } }, { entityType: "FUND_END_DATE_EXTENSION", entityId: { in: [] } }] });
});
it.each([{ role: "VILLAGER" }, { role: "SYSTEM_ADMIN" }, { villageId: "other" }, { sessionVersion: 2 }, { mustChangePassword: true }, { membershipStatus: "REMOVED" }, { village: { status: "INACTIVE" } }])("rejects unauthorized/changed authority before financial reads: %j", async (change) => {
  m.actor.mockResolvedValue({ ...await m.actor(), ...change }); await expect(getChiefFundReconciliation("f")).rejects.toThrow(); expect(m.assessments).not.toHaveBeenCalled();
});
it("foreign and missing Funds return the same denial", async () => {
  m.fund.mockResolvedValue(null); for (const id of ["foreign", "missing"]) await expect(getChiefFundReconciliation(id)).rejects.toThrow("unavailable"); expect(m.payments).not.toHaveBeenCalled();
});
it("audit cap is independently unverified despite an otherwise-valid required event", async () => {
  const valid = (await m.audits())[0];
  // Extra unknown evidence would already cause findings; this assertion specifically
  // requires cap-derived INPUT_INCOMPLETE, not just a non-clean result.
  m.audits.mockResolvedValue([valid, ...Array.from({ length: RECONCILIATION_CAP }, (_, i) => ({ ...valid, id: `extra-${i}`, entityId: "unknown", metadata: { event: "UNKNOWN" } }))]);
  const result = await getChiefFundReconciliation("f"); expect(result.findings).toContainEqual(expect.objectContaining({ category: "audit", code: "INPUT_INCOMPLETE", outcome: "UNVERIFIED" })); expect(result.metrics).not.toBeNull(); expect(result.clean).toBe(false);
});
it("unexpected database failures propagate", async () => {
  const error = new Error("database"); m.receipts.mockRejectedValue(error); await expect(getChiefFundReconciliation("f")).rejects.toBe(error);
});
it.each(["assessments", "payments", "receipts", "extensions"] as const)("%s lookahead explicitly marks the dataset incomplete", async (key) => {
  const records = {
    assessments: { id: "a", fundId: "f", villageId: "v", houseId: "h", houseNumberSnapshot: "Frozen-H", assessmentAmount: 1001 },
    payments: { id: "p", fundId: "f", villageId: "v", houseId: "h", fundHouseAssessmentId: "a", amount: 1001, status: "ACCEPTED", voidReason: null, collectorUserId: "collector" },
    receipts: { id: "r", villageId: "v", paymentId: "p", receiptNumber: "N", status: "ACTIVE" },
    extensions: { id: "e", fundId: "f", villageId: "v", previousEndDate: new Date("2026-10-31"), newEndDate: new Date("2026-11-30"), previousTermsVersion: 2, newTermsVersion: 3, changedByUserId: "chief", changedAt: new Date("2026-11-01"), reason: "Unpaid" },
  };
  m[key].mockResolvedValue(Array.from({ length: RECONCILIATION_CAP + 1 }, (_, i) => ({ ...records[key], id: `id-${i}` })));
  const result = await getChiefFundReconciliation("f");
  expect(result.findings).toContainEqual(expect.objectContaining({ outcome: "UNVERIFIED", code: "INPUT_INCOMPLETE", recordId: key === "extensions" ? "lifecycle" : key }));
  expect(result.clean).toBe(false);
});

it("exactly 10,000 valid assessments remain complete and retain all financial input", async () => {
  m.fund.mockResolvedValue({ ...await m.fund(), status: "ACTIVE", termsVersion: 2, eligibleHouseCount: RECONCILIATION_CAP, assessmentPerHouse: 1, snapshotAt: new Date("2026-11-01") });
  m.assessments.mockResolvedValue(Array.from({ length: RECONCILIATION_CAP }, (_, i) => ({ id: `a-${i}`, fundId: "f", villageId: "v", houseId: `h-${i}`, houseNumberSnapshot: `H-${i}`, assessmentAmount: 1 })));
  m.audits.mockResolvedValue([...(await m.audits()), { id: "activation", fundId: "f", villageId: "v", entityType: "FUND", entityId: "f", actionType: "STATUS_CHANGE", actorUserId: "chief", metadata: { event: "FUND_ACTIVATED", termsVersion: 2, villageTargetAmount: 1001, eligibleHouseCount: RECONCILIATION_CAP, assessmentPerHouse: 1, snapshotAt: new Date("2026-11-01").toISOString(), totalAssessment: RECONCILIATION_CAP, roundingSurplus: RECONCILIATION_CAP - 1001 } }]);
  const result = await getChiefFundReconciliation("f");
  expect(result).toMatchObject({ clean: true, findings: [], metrics: { expectedHouseholdAssessmentTotal: 10000, outstandingHouseholdObligations: 10000, unpaidFrozenAssessmentCount: 10000, acceptedCollectionAmount: 0 } });
  expect(m.assessments.mock.calls[0][0].take).toBe(RECONCILIATION_CAP + 1);
});

it("exactly 10,000 required audit events remain complete", async () => {
  const created = (await m.audits())[0];
  m.fund.mockResolvedValue({ ...await m.fund(), termsVersion: RECONCILIATION_CAP });
  m.audits.mockResolvedValue([created, ...Array.from({ length: RECONCILIATION_CAP - 1 }, (_, i) => ({ ...created, id: `edit-${i}`, actionType: "UPDATE", metadata: { event: "DRAFT_UPDATED", termsVersion: i + 2, villageTargetAmount: 1001 } }))]);
  const result = await getChiefFundReconciliation("f");
  expect(result).toMatchObject({ clean: true, findings: [], checks: { audit: "PASS" } });
  expect(m.audits.mock.calls.at(-1)?.[0].take).toBe(RECONCILIATION_CAP + 1);
});

it("binds nonempty audit association IDs to typed entities inside authenticated village scope", async () => {
  m.assessments.mockResolvedValue([{ id: "a", fundId: "f", villageId: "v", houseId: "h", houseNumberSnapshot: "Frozen-H", assessmentAmount: 1001 }]);
  m.payments.mockResolvedValue([{ id: "p", fundId: "f", villageId: "v", houseId: "h", fundHouseAssessmentId: "a", amount: 1001, status: "ACCEPTED", voidReason: null, collectorUserId: "collector" }]);
  m.receipts.mockResolvedValue([{ id: "r", villageId: "v", paymentId: "p", receiptNumber: "N", status: "ACTIVE" }]);
  m.extensions.mockResolvedValue([{ id: "e", fundId: "f", villageId: "v", previousEndDate: new Date("2026-10-31"), newEndDate: new Date("2026-11-30"), previousTermsVersion: 2, newTermsVersion: 3, changedByUserId: "chief", changedAt: new Date("2026-11-01"), reason: "Unpaid" }]);
  // This query-contract test does not assert that these synthetic rows reconcile.
  await getChiefFundReconciliation("f");
  expect(m.receipts.mock.calls[0][0].where).toEqual({ villageId: "v", OR: [{ payment: { is: { fundId: "f", villageId: "v" } } }, { paymentId: { in: ["p"] } }] });
  expect(m.audits.mock.calls[0][0].where).toEqual({ villageId: "v", OR: [
    { fundId: "f" }, { entityType: "FUND", entityId: "f" },
    { entityType: "FUND_HOUSE_ASSESSMENT", entityId: { in: ["a"] } },
    { entityType: "PAYMENT", entityId: { in: ["p"] } },
    { entityType: "RECEIPT", entityId: { in: ["r"] } },
    { entityType: "FUND_END_DATE_EXTENSION", entityId: { in: ["e"] } },
  ] });
});
