/** Authored unit coverage only. Mocked transactions do not verify PostgreSQL. */
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  requireVillager: vi.fn(), identity: vi.fn(), transaction: vi.fn(),
  readOnly: vi.fn(), actor: vi.fn(), fund: vi.fn(), house: vi.fn(), assessment: vi.fn(),
}));
vi.mock("@/lib/authz/roles", () => ({ requireVillager: m.requireVillager, requireChief: vi.fn() }));
vi.mock("@/lib/auth/session-identity", () => ({ getSessionIdentity: m.identity }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw Object.assign(new Error("redirect"), { path }); },
  notFound: () => { throw new Error("not found"); },
}));
import { getMemberCurrentFund } from "./member-fund-query";
import { FundReportIntegrityError } from "./fund-report-queries";

const actor = () => ({
  sessionVersion: 3, mustChangePassword: false, role: "VILLAGER", membershipStatus: "ACTIVE",
  villageId: "v", houseId: "session-house", village: { status: "ACTIVE" },
});
const fund = () => ({
  id: "f", name: "Fund", villageTargetAmount: 100_001, eligibleHouseCount: 100,
  assessmentPerHouse: 1_001, snapshotAt: new Date("2026-11-01"),
  startDate: new Date("2026-11-01"), endDate: new Date("2026-11-30"),
});
beforeEach(() => {
  vi.resetAllMocks();
  m.requireVillager.mockResolvedValue({ user: { id: "member", houseId: "stale-house" }, villageId: "v" });
  m.identity.mockResolvedValue({ userId: "member", sessionVersion: 3 });
  m.actor.mockResolvedValue(actor());
  m.fund.mockResolvedValue(fund());
  m.house.mockResolvedValue({ id: "session-house" });
  m.assessment.mockResolvedValue({ id: "a", assessmentAmount: 1_001, payments: [] });
  m.transaction.mockImplementation(async (body) => body({
    $executeRaw: m.readOnly, user: { findUnique: m.actor }, fund: { findFirst: m.fund },
    house: { findFirst: m.house }, fundHouseAssessment: { findFirst: m.assessment },
  }));
});

describe("member current-fund presentation", () => {
  it("scopes assessment reads to the actor's current server-side household", async () => {
    const result = await getMemberCurrentFund();
    expect(result?.household).toEqual({ state: "UNPAID", assessmentAmount: 1_001, outstandingAmount: 1_001 });
    expect(m.actor).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "member" } }));
    expect(m.assessment.mock.calls[0][0].where).toEqual({ fundId: "f", villageId: "v", houseId: "session-house" });
    expect(m.assessment.mock.calls[0][0].select.payments.where).toEqual({
      fundId: "f", villageId: "v", houseId: "session-house", status: "ACCEPTED",
    });
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", maxWait: 2000, timeout: 5000 });
    expect(m.readOnly.mock.invocationCallOrder[0]).toBeLessThan(m.actor.mock.invocationCallOrder[0]);
  });
  it("does not assign an obligation when no household is linked", async () => {
    m.actor.mockResolvedValue({ ...actor(), houseId: null });
    expect((await getMemberCurrentFund())?.household).toEqual({ state: "NO_HOUSEHOLD", assessmentAmount: null, outstandingAmount: null });
    expect(m.assessment).not.toHaveBeenCalled();
  });
  it("does not assign an obligation to a household outside the snapshot", async () => {
    m.assessment.mockResolvedValue(null);
    expect((await getMemberCurrentFund())?.household).toEqual({ state: "NOT_ASSESSED", assessmentAmount: null, outstandingAmount: null });
  });
  it("settles only this assessment when its accepted payment overpays", async () => {
    m.assessment.mockResolvedValue({ id: "a", assessmentAmount: 1_001, payments: [{ id: "p", amount: 100_001 }] });
    expect((await getMemberCurrentFund())?.household).toEqual({ state: "PAID", assessmentAmount: 1_001, outstandingAmount: 0 });
  });
  it("returns no fund rather than inventing a snapshot", async () => {
    m.fund.mockResolvedValue(null);
    expect(await getMemberCurrentFund()).toBeNull();
    expect(m.assessment).not.toHaveBeenCalled();
  });
  it.each([
    { role: "CHIEF" }, { membershipStatus: "PENDING" }, { villageId: "foreign" }, { village: { status: "SUSPENDED" } },
  ])("rejects a changed grant before reading a fund: %j", async (change) => {
    m.actor.mockResolvedValue({ ...actor(), ...change });
    await expect(getMemberCurrentFund()).rejects.toThrow();
    expect(m.fund).not.toHaveBeenCalled();
  });
  it.each([{ sessionVersion: 4 }, { mustChangePassword: true }])("rejects session/password changes: %j", async (change) => {
    m.actor.mockResolvedValue({ ...actor(), ...change });
    await expect(getMemberCurrentFund()).rejects.toThrow();
    expect(m.fund).not.toHaveBeenCalled();
  });
  it("rejects a missing identity before starting a transaction", async () => {
    m.identity.mockResolvedValue(null);
    await expect(getMemberCurrentFund()).rejects.toThrow();
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("propagates the Villager guard denial", async () => {
    m.requireVillager.mockRejectedValue(new Error("denied"));
    await expect(getMemberCurrentFund()).rejects.toThrow("denied");
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it.each([
    { assessmentAmount: 999, payments: [] },
    { assessmentAmount: 1_001, payments: [{ id: "p", amount: 1_000 }] },
    { assessmentAmount: 1_001, payments: [{ id: "p", amount: 1_001 }, { id: "q", amount: 1_001 }] },
  ])("fails closed on inconsistent assessment/payment data: %j", async (assessment) => {
    m.assessment.mockResolvedValue({ id: "a", ...assessment });
    await expect(getMemberCurrentFund()).rejects.toBeInstanceOf(FundReportIntegrityError);
  });
  it("rejects invalid frozen fund metadata", async () => {
    m.fund.mockResolvedValue({ ...fund(), assessmentPerHouse: null });
    await expect(getMemberCurrentFund()).rejects.toBeInstanceOf(FundReportIntegrityError);
  });
});
