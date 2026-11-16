/** Real reader/query construction, mocked DB/auth boundaries. Not PostgreSQL verification. */
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ collector: vi.fn(), receiptAccess: vi.fn(), identity: vi.fn(), actor: vi.fn(), assignment: vi.fn(), funds: vi.fn(), paymentRows: vi.fn(), receiptRows: vi.fn(), paymentAnchor: vi.fn(), receiptAnchor: vi.fn(), readOnly: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireActiveCollector: m.collector, getCurrentPeriod: () => ({ year: 2026, month: 11 }) }));
vi.mock("@/features/receipt-viewing/lib/receipt-access", () => ({ requireReceiptAccess: m.receiptAccess }));
vi.mock("@/lib/auth/session-identity", () => ({ getSessionIdentity: m.identity }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(path); } }));
import { getCashHistory, getReceiptHistory, type HistoryResult } from "./history-queries";
import { parseHistoryFilters } from "./history-filters";
import { encodeHistoryCursor } from "./history-cursor";
const time = new Date("2026-11-15T00:00:00Z");
const payment = (id: string) => ({ id, createdAt: time, status: "ACCEPTED", amount: 1001, voidReason: null, assessment: { houseNumberSnapshot: "Frozen" }, fund: { status: "CLOSED", name: "Past Fund" }, payer: { name: "Payer" } });
const receipt = (id: string) => ({ id, receiptNumber: `ORIGINAL-${id}`, status: "VOIDED", payment: { id: `p-${id}`, status: "VOIDED", amount: 1001, createdAt: time, fund: { name: "Past Fund" } } });
beforeEach(() => {
  vi.resetAllMocks();
  const context = { user: { id: "actor" }, villageId: "v" };
  m.collector.mockResolvedValue(context); m.receiptAccess.mockResolvedValue({ ...context, accessLevel: "own" });
  m.identity.mockResolvedValue({ userId: "actor", sessionVersion: 2 });
  m.actor.mockResolvedValue({ id: "actor", role: "VILLAGER", membershipStatus: "ACTIVE", villageId: "v", village: { status: "ACTIVE" }, sessionVersion: 2, mustChangePassword: false });
  m.assignment.mockResolvedValue({ id: "assignment" }); m.funds.mockResolvedValue([{ id: "past", name: "Past Fund" }]);
  m.paymentRows.mockResolvedValue([]); m.receiptRows.mockResolvedValue([]);
  m.paymentAnchor.mockResolvedValue({ id: "anchor", createdAt: time }); m.receiptAnchor.mockResolvedValue({ id: "anchor", payment: { createdAt: time } });
  m.transaction.mockImplementation(async (body) => body({ $executeRaw: m.readOnly, user: { findUnique: m.actor }, collectorAssignment: { findFirst: m.assignment }, fund: { findMany: m.funds }, payment: { findMany: m.paymentRows, findFirst: m.paymentAnchor }, receipt: { findMany: m.receiptRows, findFirst: m.receiptAnchor } }));
});
function token(kind: "cash" | "receipt", params = {}) {
  const f = parseHistoryFilters(params); if (!f.ok) throw new Error("Invalid fixture");
  return encodeHistoryCursor(kind, f, "anchor");
}
describe("history reader authorization and consistency", () => {
  it("uses a short READ ONLY repeatable read snapshot before data reads", async () => {
    await getCashHistory();
    expect(m.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead", maxWait: 2000, timeout: 5000 });
    expect(m.readOnly.mock.calls[0][0].join("")).toBe("SET TRANSACTION READ ONLY");
    expect(m.readOnly.mock.invocationCallOrder[0]).toBeLessThan(m.actor.mock.invocationCallOrder[0]);
    expect(m.paymentRows.mock.calls[0][0].select).toMatchObject({ assessment: { select: { houseNumberSnapshot: true } }, fund: { select: { status: true, name: true } } });
    expect(m.funds.mock.calls[0][0].where).toEqual({ villageId: "v", payments: { some: { villageId: "v" } } });
  });
  it.each(["CHIEF", "VILLAGER"])("scopes %s receipt Fund options and rows", async (role) => {
    m.actor.mockResolvedValue({ ...await m.actor(), role });
    const result = await getReceiptHistory(); expect(result.ok).toBe(true);
    const scope = role === "CHIEF" ? { villageId: "v" } : { villageId: "v", OR: [{ collectorUserId: "actor" }, { payerUserId: "actor" }] };
    expect(m.funds.mock.calls[0][0].where.payments.some).toEqual({ AND: [scope, { receipt: { isNot: null } }] });
    expect(m.receiptRows.mock.calls[0][0].where).toEqual({ AND: [{ villageId: "v", payment: { is: { AND: [{ AND: [scope, { receipt: { isNot: null } }] }] } } }] });
  });
  it("narrows former Collectors to own receipts and denies cash history", async () => {
    m.assignment.mockResolvedValue(null);
    await getReceiptHistory();
    expect(m.funds.mock.calls[0][0].where.payments.some).toEqual({ AND: [{ villageId: "v", payerUserId: "actor" }, { receipt: { isNot: null } }] });
    await expect(getCashHistory()).rejects.toThrow("/forbidden");
  });
  it.each([{ sessionVersion: 3 }, { mustChangePassword: true }, { membershipStatus: "REMOVED" }, { villageId: "other" }, { village: { status: "INACTIVE" } }, { role: "SYSTEM_ADMIN" }])("rejects changed actor %j before history data", async (change) => {
    m.actor.mockResolvedValue({ ...await m.actor(), ...change });
    await expect(getCashHistory()).rejects.toThrow();
    expect(m.funds).not.toHaveBeenCalled(); expect(m.paymentRows).not.toHaveBeenCalled();
  });
  it("does not use browser identity, and foreign/missing Fund IDs have the same recovery", async () => {
    for (const fundId of ["foreign", "missing"]) expect(await getReceiptHistory({ fundId, villageId: "other", userId: "other" })).toMatchObject({ ok: false, error: "UNAVAILABLE" });
    expect(m.receiptRows).not.toHaveBeenCalled();
  });
  it("rejects missing identity and preflight denial before a transaction", async () => {
    m.identity.mockResolvedValue(null);
    await expect(getCashHistory()).rejects.toThrow("/login");
    expect(m.transaction).not.toHaveBeenCalled();
    m.collector.mockRejectedValue(new Error("forbidden"));
    await expect(getCashHistory()).rejects.toThrow("forbidden");
  });
  it("invalid dates never execute a history rows query, and unexpected errors propagate", async () => {
    expect(await getCashHistory({ dateFrom: "2026-02-30" })).toMatchObject({ ok: false, error: "DATE" });
    expect(m.paymentRows).not.toHaveBeenCalled();
    const error = new Error("database unavailable"); m.paymentRows.mockRejectedValue(error);
    await expect(getCashHistory()).rejects.toBe(error);
  });
  it("retains VOIDED receipt identity and checks linked status", async () => {
    m.receiptRows.mockResolvedValue([receipt("original")]);
    expect(await getReceiptHistory()).toMatchObject({ ok: true, receipts: [{ id: "original", receiptNumber: "ORIGINAL-original", status: "VOIDED", payment: { status: "VOIDED" } }] });
    m.receiptRows.mockResolvedValue([{ ...receipt("bad"), status: "ACTIVE" }]);
    await expect(getReceiptHistory()).rejects.toThrow("integrity");
  });
});
describe("keyset contracts", () => {
  for (const kind of ["cash", "receipt"] as const) {
    const read = kind === "cash" ? getCashHistory : getReceiptHistory;
    const rows = () => kind === "cash" ? m.paymentRows : m.receiptRows;
    const size = kind === "cash" ? 20 : 50;
    it(`${kind} looks ahead beyond the old limit and binds next navigation`, async () => {
      rows().mockResolvedValue(Array.from({ length: size + 1 }, (_, i) => kind === "cash" ? payment(`id-${100 - i}`) : receipt(`id-${100 - i}`)));
      const result = await read();
      expect(rows().mock.calls[0][0].take).toBe(size + 1);
      expect(result).toMatchObject({ ok: true, older: expect.any(String), newer: null });
      if (!result.ok) throw new Error("Unexpected recovery");
      expect((kind === "cash" ? result.payments : result.receipts)).toHaveLength(size);
    });
    it.each(["older", "newer"] as const)(`${kind} uses timestamp plus unique ID for %s tie navigation`, async (direction) => {
      rows().mockResolvedValue([kind === "cash" ? payment("neighbor") : receipt("neighbor")]);
      const result = await read({ cursor: token(kind), direction });
      expect(result.ok).toBe(true);
      const query = rows().mock.calls[0][0];
      const comparator = direction === "older" ? "lt" : "gt";
      expect(query.orderBy).toEqual(kind === "cash" ? [{ createdAt: direction === "older" ? "desc" : "asc" }, { id: direction === "older" ? "desc" : "asc" }]
        : [{ payment: { createdAt: direction === "older" ? "desc" : "asc" } }, { id: direction === "older" ? "desc" : "asc" }]);
      expect(query.where.AND[1]).toEqual({ OR: kind === "cash" ? [{ createdAt: { [comparator]: time } }, { createdAt: time, id: { [comparator]: "anchor" } }]
        : [{ payment: { is: { createdAt: { [comparator]: time } } } }, { payment: { is: { createdAt: time } }, id: { [comparator]: "anchor" } }] });
    });
    it(`${kind} resolves scoped anchors and recovers stale/mismatched navigation`, async () => {
      const anchor = kind === "cash" ? m.paymentAnchor : m.receiptAnchor;
      anchor.mockResolvedValue(null);
      expect(await read({ cursor: token(kind), direction: "older" })).toMatchObject({ ok: false, error: "STALE" });
      expect(anchor.mock.calls[0][0].where.AND[1]).toEqual({ id: "anchor" });
      expect(rows()).not.toHaveBeenCalled();
      expect(await read({ cursor: token(kind), direction: "older", status: "VOIDED" })).toMatchObject({ ok: false, error: "CURSOR" });
    });
    it(`${kind} uses payment date/status with authorized filters`, async () => {
      await read({ fundId: "past", status: "VOIDED", dateFrom: "2026-11-15", dateTo: "2026-11-15" });
      const query = rows().mock.calls[0][0];
      const conditions = kind === "cash" ? query.where.AND[0].AND : query.where.AND[0].payment.is.AND;
      expect(conditions.slice(1)).toEqual([{ fundId: "past" }, { status: "VOIDED" }, { createdAt: { gte: new Date("2026-11-14T17:30Z"), lt: new Date("2026-11-15T17:30Z") } }]);
    });
  }
});

// An independent in-memory database boundary exercises multi-request traversal.
// This does not claim PostgreSQL ordering/collation or transaction verification.
describe("multi-page equal-timestamp traversal", () => {
  for (const kind of ["cash", "receipt"] as const) {
    it(`${kind} discovers all old records, reverses pages, and is not shifted by a newer insertion`, async () => {
      const read = kind === "cash" ? getCashHistory : getReceiptHistory;
      const size = kind === "cash" ? 20 : 50;
      const dataset = Array.from({ length: size * 2 + 3 }, (_, i) => `id-${String(i).padStart(4, "0")}`).reverse();
      const expected = [...dataset];
      const anchorRead = kind === "cash" ? m.paymentAnchor : m.receiptAnchor;
      anchorRead.mockImplementation(async ({ where }) => {
        const id = where.AND[1].id;
        return dataset.includes(id) ? kind === "cash" ? { id, createdAt: time } : { id, payment: { createdAt: time } } : null;
      });
      const rowRead = kind === "cash" ? m.paymentRows : m.receiptRows;
      rowRead.mockImplementation(async ({ where, orderBy, take }) => {
        const ascending = orderBy[1].id === "asc";
        const idCondition = where.AND[1]?.OR[1].id;
        const ids = dataset.filter((id) => !idCondition || (ascending ? id > idCondition.gt : id < idCondition.lt));
        if (ascending) ids.reverse();
        return ids.slice(0, take).map((id) => kind === "cash" ? payment(id) : receipt(id));
      });
      const first = await read(); if (!first.ok || !first.older) throw new Error("Expected first page");
      const ids = (result: Extract<HistoryResult, { ok: true }>) => (kind === "cash" ? result.payments : result.receipts).map((row) => row.id);
      expect(ids(first)).toEqual(expected.slice(0, size));
      const second = await read({ cursor: first.older, direction: "older" });
      if (!second.ok || !second.newer) throw new Error("Expected second page");
      const back = await read({ cursor: second.newer, direction: "newer" });
      if (!back.ok) throw new Error("Expected previous page");
      expect(ids(back)).toEqual(ids(first));
      dataset.unshift("id-9999");
      const seen = [...ids(first)];
      let cursor: string | null = first.older;
      for (let requests = 0; cursor && requests < 10; requests++) {
        const result = await read({ cursor, direction: "older" });
        if (!result.ok) throw new Error("Unexpected recovery");
        seen.push(...ids(result)); cursor = result.older;
      }
      expect(cursor).toBeNull(); expect(seen).toEqual(expected);
      expect(new Set(seen).size).toBe(expected.length);
    });
  }
});
