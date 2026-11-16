/** Mocked query/authority contracts only; no PostgreSQL behavior is verified. */
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ chief: vi.fn(), identity: vi.fn(), transaction: vi.fn(), readOnly: vi.fn(), actor: vi.fn(), fund: vi.fn(), rows: vi.fn(), anchor: vi.fn(), evidence: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireChief: m.chief }));
vi.mock("@/lib/auth/session-identity", () => ({ getSessionIdentity: m.identity }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(path); }, notFound: () => { throw new Error("unavailable"); } }));
import { getChiefFundLifecycleHistory } from "./fund-lifecycle-history";
const end = new Date("2026-11-30");
const row = () => ({ id: "e", fundId: "f", villageId: "v", previousEndDate: new Date("2026-10-31"), newEndDate: end,
  previousTermsVersion: 2, newTermsVersion: 3, changedByUserId: "old-chief", changedBy: { id: "old-chief", name: "Current name" }, changedAt: new Date("2026-11-01T00:00Z"), reason: "Unpaid households" });
const evidence = () => ({ entityId: "e", entityType: "FUND_END_DATE_EXTENSION", actionType: "UPDATE", actorUserId: "old-chief", metadata: { event: "FUND_EXTENDED", extensionId: "e", previousEndDate: "2026-10-31", newEndDate: "2026-11-30", reason: "Unpaid households", termsVersion: 3 } });
beforeEach(() => {
  vi.resetAllMocks(); m.chief.mockResolvedValue({ villageId: "v", user: { id: "chief" } }); m.identity.mockResolvedValue({ userId: "chief", sessionVersion: 1 });
  m.actor.mockResolvedValue({ role: "CHIEF", membershipStatus: "ACTIVE", villageId: "v", village: { status: "ACTIVE" }, sessionVersion: 1, mustChangePassword: false });
  m.fund.mockResolvedValue({ id: "f", villageId: "v", status: "ACTIVE", termsVersion: 3, endDate: end, closedAt: null, closedByUserId: null, closedBy: null });
  m.rows.mockResolvedValue([row()]); m.evidence.mockResolvedValue([evidence()]);
  m.transaction.mockImplementation(async (body) => body({ $executeRaw: m.readOnly, user: { findUnique: m.actor }, fund: { findFirst: m.fund }, fundEndDateExtension: { findMany: m.rows, findFirst: m.anchor }, auditLog: { findMany: m.evidence } }));
});
describe("Chief lifecycle history", () => {
  it("reauthorizes and reads authoritative facts inside a bounded read-only snapshot", async () => {
    const result = await getChiefFundLifecycleHistory("f");
    expect(m.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead", maxWait: 2000, timeout: 5000 });
    expect(m.readOnly.mock.calls[0][0].join("")).toBe("SET TRANSACTION READ ONLY");
    expect(m.readOnly.mock.invocationCallOrder[0]).toBeLessThan(m.actor.mock.invocationCallOrder[0]);
    expect(m.fund.mock.calls[0][0].where).toEqual({ id: "f", villageId: "v" });
    expect(m.rows.mock.calls[0][0]).toMatchObject({ take: 21, orderBy: [{ newTermsVersion: "desc" }, { id: "desc" }], where: { AND: [{ fundId: "f", villageId: "v" }] } });
    expect(result.extensions[0]).toMatchObject({ reason: "Unpaid households", actorName: "Current name", previousTermsVersion: 2, newTermsVersion: 3, evidenceWarning: false });
  });
  it.each([{ role: "VILLAGER" }, { role: "SYSTEM_ADMIN" }, { sessionVersion: 2 }, { mustChangePassword: true }, { membershipStatus: "REMOVED" }, { villageId: "foreign" }, { village: { status: "INACTIVE" } }])("rejects changed authority %j before Fund reads", async (change) => {
    m.actor.mockResolvedValue({ ...await m.actor(), ...change });
    await expect(getChiefFundLifecycleHistory("f")).rejects.toThrow(); expect(m.fund).not.toHaveBeenCalled();
  });
  it("preserves preflight denial and missing/foreign Fund non-disclosure", async () => {
    m.chief.mockRejectedValueOnce(new Error("denied")); await expect(getChiefFundLifecycleHistory("f")).rejects.toThrow("denied"); expect(m.transaction).not.toHaveBeenCalled();
    m.fund.mockResolvedValue(null);
    for (const id of ["foreign", "missing"]) await expect(getChiefFundLifecycleHistory(id)).rejects.toThrow("unavailable");
    expect(m.rows).not.toHaveBeenCalled();
  });
  it.each([undefined, true])("never replaces facts when evidence is missing or conflicting: %s", async (conflict) => {
    m.evidence.mockResolvedValue(conflict ? [{ ...evidence(), metadata: { ...evidence().metadata, reason: "Different" } }] : []);
    expect((await getChiefFundLifecycleHistory("f")).extensions[0]).toMatchObject({ reason: "Unpaid households", evidenceWarning: true });
  });
  it("flags duplicate and overflow evidence without duplicating lifecycle events", async () => {
    for (const count of [2, 201]) {
      m.evidence.mockResolvedValue(Array.from({ length: count }, evidence));
      const result = await getChiefFundLifecycleHistory("f"); expect(result.extensions).toHaveLength(1); expect(result.extensions[0].evidenceWarning).toBe(true);
    }
  });
  it("uses scoped version/ID seeks and lookahead, including equal event times", async () => {
    m.anchor.mockResolvedValue({ id: "anchor", newTermsVersion: 30 });
    m.rows.mockResolvedValue(Array.from({ length: 21 }, (_, i) => ({ ...row(), id: `e-${i}`, previousTermsVersion: 28 - i, newTermsVersion: 29 - i })));
    const result = await getChiefFundLifecycleHistory("f", "anchor");
    expect(m.anchor.mock.calls[0][0].where).toEqual({ fundId: "f", villageId: "v", id: "anchor" });
    expect(m.rows.mock.calls[0][0].where.AND[1]).toEqual({ OR: [{ newTermsVersion: { lt: 30 } }, { newTermsVersion: 30, id: { lt: "anchor" } }] });
    expect(result.extensions).toHaveLength(20); expect(result.older).toBe("e-19");
  });
  it.each(["missing", ["e", "other"]])("does not broaden a stale or repeated cursor: %j", async (before) => {
    m.anchor.mockResolvedValue(null); const result = await getChiefFundLifecycleHistory("f", before);
    expect(result.stale).toBe(true); expect(m.rows).not.toHaveBeenCalled();
  });
  it("uses persisted closure time/actor and validates metadata time, not log insertion time", async () => {
    const closedAt = new Date("2026-12-01T00:00:00Z");
    m.fund.mockResolvedValue({ ...await m.fund(), status: "CLOSED", termsVersion: 4, closedAt, closedByUserId: "old-chief", closedBy: { id: "old-chief", name: "Current name" } });
    m.evidence.mockResolvedValue([{ entityType: "FUND", entityId: "f", actionType: "STATUS_CHANGE", actorUserId: "old-chief", metadata: { event: "FUND_CLOSED", closedAt: closedAt.toISOString(), termsVersion: 4 } }]);
    const result = await getChiefFundLifecycleHistory("f"); expect(result.closureWarning).toBe(false); expect(result.fund.closedAt).toBe(closedAt);
    m.evidence.mockResolvedValue([]); expect((await getChiefFundLifecycleHistory("f")).closureWarning).toBe(true);
  });
  it("does not synthesize extensions from unmatched audit events", async () => {
    m.rows.mockResolvedValue([]); expect((await getChiefFundLifecycleHistory("f")).extensions).toEqual([]);
  });
  it("propagates unexpected database failures", async () => {
    const error = new Error("database"); m.rows.mockRejectedValue(error); await expect(getChiefFundLifecycleHistory("f")).rejects.toBe(error);
  });
});
