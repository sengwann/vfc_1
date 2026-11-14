/** Always-on reader unit tests: real reader/calculators, mocked auth/Prisma.
 * No credentials, opt-in, network or database connection is required.
 * Snapshot interleavings below are simulations, not PostgreSQL verification. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  chief: vi.fn(),
  identity: vi.fn(),
  transaction: vi.fn(),
  readOnly: vi.fn(),
  user: vi.fn(),
  fund: vi.fn(),
  assessments: vi.fn(),
  payments: vi.fn(),
}));
vi.mock("@/lib/authz/roles", () => ({ requireChief: m.chief }));
vi.mock("@/lib/auth/session-identity", () => ({
  getSessionIdentity: m.identity,
}));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw Object.assign(new Error("redirect"), { path });
  },
  notFound: () => {
    throw Object.assign(new Error("not found"), { digest: "TEST_NOT_FOUND" });
  },
}));
import {
  FundReportIntegrityError,
  getChiefFundReport,
} from "./fund-report-queries";

function fixture() {
  return {
    actor: {
      sessionVersion: 1,
      mustChangePassword: false,
      role: "CHIEF",
      membershipStatus: "ACTIVE",
      villageId: "v",
      village: { status: "ACTIVE" },
    },
    fund: {
      id: "f",
      villageId: "v",
      name: "Fund",
      status: "ACTIVE" as "DRAFT" | "ACTIVE" | "CLOSED",
      villageTargetAmount: 100_001,
      eligibleHouseCount: 100 as number | null,
      assessmentPerHouse: 1_001 as number | null,
      snapshotAt: new Date("2026-11-01") as Date | null,
      termsVersion: 2,
    },
    assessments: Array.from({ length: 100 }, (_, i) => ({
      id: `a${i}`,
      houseId: `h${i}`,
      fundId: "f",
      villageId: "v",
      houseNumberSnapshot: `Frozen H${i}`,
      assessmentAmount: 1_001,
    })),
    payments: [
      {
        id: "p",
        fundId: "f",
        villageId: "v",
        houseId: "h0",
        fundHouseAssessmentId: "a0",
        amount: 1_001,
        status: "ACCEPTED" as "ACCEPTED" | "VOIDED",
      },
    ],
  };
}

function minimalFrozenFixture() {
  const snapshot = fixture();
  Object.assign(snapshot.fund, {
    villageTargetAmount: 1,
    eligibleHouseCount: 2,
    assessmentPerHouse: 1,
  });
  snapshot.assessments = snapshot.assessments
    .slice(0, 2)
    .map((row) => ({ ...row, assessmentAmount: 1 }));
  snapshot.payments = [];
  return snapshot;
}

function draftFixture() {
  const snapshot = fixture();
  Object.assign(snapshot.fund, {
    status: "DRAFT",
    eligibleHouseCount: null,
    assessmentPerHouse: null,
    snapshotAt: null,
  });
  snapshot.assessments = [];
  snapshot.payments = [];
  return snapshot;
}

function expectNoFinancialReads() {
  expect(m.fund).not.toHaveBeenCalled();
  expect(m.assessments).not.toHaveBeenCalled();
  expect(m.payments).not.toHaveBeenCalled();
}

let live: ReturnType<typeof fixture>;
let visible: ReturnType<typeof fixture>;
const tx = {
  $executeRaw: m.readOnly,
  user: { findUnique: m.user },
  fund: { findFirst: m.fund },
  fundHouseAssessment: { findMany: m.assessments },
  payment: { findMany: m.payments },
};
beforeEach(() => {
  vi.resetAllMocks();
  live = fixture();
  m.chief.mockResolvedValue({ user: { id: "chief" }, villageId: "v" });
  m.identity.mockResolvedValue({ userId: "chief", sessionVersion: 1 });
  m.transaction.mockImplementation(
    async (body: (client: typeof tx) => Promise<unknown>) => {
      visible = structuredClone(live);
      return body(tx);
    },
  );
  m.readOnly.mockResolvedValue(0);
  m.user.mockImplementation(async () => visible.actor);
  m.fund.mockImplementation(async () => visible.fund);
  m.assessments.mockImplementation(async () => visible.assessments);
  m.payments.mockImplementation(async () => visible.payments);
});

describe("authorized complete fund report reader", () => {
  it("authenticates every call and derives village scope from Chief context", async () => {
    const report = await getChiefFundReport("f");
    expect(m.chief).toHaveBeenCalledTimes(1);
    expect(m.identity).toHaveBeenCalledTimes(1);
    expect(m.user).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "chief" } }),
    );
    expect(m.fund).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "f", villageId: "v" } }),
    );
    expect(m.assessments).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fundId: "f", villageId: "v" } }),
    );
    expect(m.payments).toHaveBeenCalledWith(
      expect.objectContaining({ where: { fundId: "f", villageId: "v" } }),
    );
    expect(report.metrics).toMatchObject({
      acceptedCollectionAmount: 1_001,
      remainingVillageTarget: 99_000,
      excessCollectionOverVillageTarget: 0,
      outstandingHouseholdObligations: 99_099,
      isComplete: false,
    });
    await getChiefFundReport("f");
    expect(m.chief).toHaveBeenCalledTimes(2);
  });

  it("propagates the existing Chief guard's authentication/authorization rejection before querying", async () => {
    m.chief.mockRejectedValue(
      Object.assign(new Error("denied"), { path: "/forbidden" }),
    );
    await expect(getChiefFundReport("f")).rejects.toMatchObject({
      path: "/forbidden",
    });
    expect(m.transaction).not.toHaveBeenCalled();
    expectNoFinancialReads();
  });

  it("rejects missing or changed verified identity before reading financial data", async () => {
    for (const identity of [null, { userId: "other", sessionVersion: 1 }]) {
      m.identity.mockResolvedValue(identity);
      await expect(getChiefFundReport("f")).rejects.toMatchObject({
        path: "/login",
      });
    }
    expect(m.transaction).not.toHaveBeenCalled();
    expectNoFinancialReads();
  });

  it.each([
    ["role", "VILLAGER", "/forbidden"],
    ["role", "SYSTEM_ADMIN", "/forbidden"],
    ["membershipStatus", "REMOVED", "/forbidden"],
    ["villageId", "foreign", "/forbidden"],
    ["mustChangePassword", true, "/change-password"],
    ["sessionVersion", 2, "/login"],
  ])(
    "rechecks actor %s inside the report snapshot",
    async (field, value, path) => {
      Object.assign(live.actor, { [field as string]: value });
      await expect(getChiefFundReport("f")).rejects.toMatchObject({ path });
      expect(m.fund).not.toHaveBeenCalled();
      expectNoFinancialReads();
    },
  );

  it("rejects a deleted actor and an inactive village", async () => {
    m.user.mockResolvedValueOnce(null);
    await expect(getChiefFundReport("f")).rejects.toMatchObject({
      path: "/login",
    });
    expectNoFinancialReads();
    live.actor.village.status = "SUSPENDED";
    await expect(getChiefFundReport("f")).rejects.toMatchObject({
      path: "/forbidden",
    });
    expectNoFinancialReads();
  });

  it("returns not-found for missing or cross-village IDs without reading assessments", async () => {
    m.fund.mockResolvedValue(null);
    await expect(getChiefFundReport("foreign-fund")).rejects.toMatchObject({
      digest: "TEST_NOT_FOUND",
    });
    expect(m.fund).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "foreign-fund", villageId: "v" },
      }),
    );
    expect(m.assessments).not.toHaveBeenCalled();
  });

  it("fails closed if a query returns a foreign fund despite its tenant predicate", async () => {
    live.fund.villageId = "foreign";
    await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
      FundReportIntegrityError,
    );
  });

  it.each([0, 99])(
    "rejects missing/incomplete assessment sets of size %s",
    async (count) => {
      live.assessments = live.assessments.slice(0, count);
      await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
        FundReportIntegrityError,
      );
    },
  );

  it("accepts two distinct 1 MMK assessments with distinct house IDs", async () => {
    live = minimalFrozenFixture();
    const report = await getChiefFundReport("f");
    expect(report.metrics).toMatchObject({
      expectedHouseholdAssessmentTotal: 2,
      roundingSurplus: 1,
      acceptedCollectionAmount: 0,
      outstandingHouseholdObligations: 2,
      paidFrozenAssessmentCount: 0,
      unpaidFrozenAssessmentCount: 2,
      isComplete: false,
    });
    expect(report.assessmentPage.rows).toEqual([
      expect.objectContaining({ id: "a0", houseId: "h0", assessmentAmount: 1 }),
      expect.objectContaining({ id: "a1", houseId: "h1", assessmentAmount: 1 }),
    ]);
  });

  it("rejects duplicate assessment IDs independently of payment linkage or assessment totals", async () => {
    live = minimalFrozenFixture();
    live.assessments[1].id = live.assessments[0].id;
    // Without the duplicate-ID guard, the remaining Map entry still covers the
    // 1 MMK target. There are no payments to trigger a separate linkage error.
    const report = getChiefFundReport("f");
    await expect(report).rejects.toBeInstanceOf(FundReportIntegrityError);
    await expect(report).rejects.toMatchObject({
      name: "FundReportIntegrityError",
      message: "Fund reporting snapshot is inconsistent.",
    });
  });

  it("rejects an incomplete frozen snapshot independently of rounding or assessment totals", async () => {
    live = minimalFrozenFixture();
    live.assessments = live.assessments.slice(0, 1);
    // Frozen count stays 2. Recalculating with one row would still yield 1 MMK
    // per house, and its total would cover the target, isolating the count guard.
    const report = getChiefFundReport("f");
    await expect(report).rejects.toBeInstanceOf(FundReportIntegrityError);
    await expect(report).rejects.toMatchObject({
      name: "FundReportIntegrityError",
      message: "Fund reporting snapshot is inconsistent.",
    });
  });

  it.each(["count", "amount", "uniform", "snapshot", "version"])(
    "rejects invalid frozen metadata: %s",
    async (kind) => {
      if (kind === "count") live.fund.eligibleHouseCount = null;
      if (kind === "amount") live.fund.assessmentPerHouse = 1_002;
      if (kind === "uniform") live.assessments[1].assessmentAmount = 1_002;
      if (kind === "snapshot") live.fund.snapshotAt = null;
      if (kind === "version") live.fund.termsVersion = 0;
      await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
        FundReportIntegrityError,
      );
    },
  );

  it.each(["fundId", "villageId", "houseId", "fundHouseAssessmentId"])(
    "rejects payment linkage mismatch: %s",
    async (field) => {
      Object.assign(live.payments[0], { [field]: "foreign" });
      await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
        FundReportIntegrityError,
      );
    },
  );

  it.each(["fundId", "villageId", "houseId"])(
    "rejects foreign or duplicate assessment identity: %s",
    async (field) => {
      Object.assign(live.assessments[1], {
        [field]: field === "houseId" ? "h0" : "foreign",
      });
      await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
        FundReportIntegrityError,
      );
    },
  );

  it.each(["same assessment", "different assessment", "voided duplicate"])(
    "rejects duplicate payment identity: %s",
    async (kind) => {
      live.payments.push({
        ...live.payments[0],
        ...(kind === "different assessment"
          ? { houseId: "h1", fundHouseAssessmentId: "a1" }
          : {}),
        ...(kind === "voided duplicate" ? { status: "VOIDED" as const } : {}),
      });
      await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
        FundReportIntegrityError,
      );
    },
  );

  it("rejects two distinct accepted payments for one assessment through the approved calculator", async () => {
    live.payments.push({ ...live.payments[0], id: "p2" });
    await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
      FundReportIntegrityError,
    );
  });

  it("retains void history without counting it alongside its accepted replacement", async () => {
    live.payments.unshift({
      ...live.payments[0],
      id: "original",
      status: "VOIDED",
    });
    const report = await getChiefFundReport("f");
    expect(report.metrics).toMatchObject({
      acceptedCollectionAmount: 1_001,
      paidFrozenAssessmentCount: 1,
    });
  });

  it("keeps all 100 assessments in metric input while paginating display only", async () => {
    const report = await getChiefFundReport("f", { page: 2, pageSize: 10 });
    expect(report.assessmentPage).toMatchObject({
      page: 2,
      pageSize: 10,
      total: 100,
      totalPages: 10,
    });
    expect(report.assessmentPage.rows).toHaveLength(10);
    expect(report.assessmentPage.rows[0].id).toBe("a10");
    expect(report.metrics).toMatchObject({
      paidFrozenAssessmentCount: 1,
      unpaidFrozenAssessmentCount: 99,
      expectedHouseholdAssessmentTotal: 100_100,
    });
    expect(m.assessments.mock.calls[0][0]).not.toHaveProperty("take");
    expect(m.assessments.mock.calls[0][0]).not.toHaveProperty("skip");
    expect(m.payments.mock.calls[0][0]).not.toHaveProperty("take");
  });

  it("requests one bounded read-only Repeatable Read transaction and simulates a concurrent void", async () => {
    m.fund.mockImplementation(async () => {
      // Commit in another hypothetical session after metadata has been read.
      live.payments[0].status = "VOIDED";
      return visible.fund;
    });
    const before = await getChiefFundReport("f");
    expect(before.metrics).toMatchObject({
      acceptedCollectionAmount: 1_001,
      paidFrozenAssessmentCount: 1,
    });
    const after = await getChiefFundReport("f");
    expect(after.metrics).toMatchObject({
      acceptedCollectionAmount: 0,
      paidFrozenAssessmentCount: 0,
    });
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
      maxWait: 2_000,
      timeout: 5_000,
    });
    expect(m.readOnly.mock.calls[0][0].join("")).toBe(
      "SET TRANSACTION READ ONLY",
    );
    expect(m.readOnly.mock.invocationCallOrder[0]).toBeLessThan(
      m.user.mock.invocationCallOrder[0],
    );
    // The supplied fake transaction has no write/scope/lock methods; any use fails.
  });

  it("reports a draft without a snapshot and rejects fabricated draft rows", async () => {
    Object.assign(live.fund, {
      status: "DRAFT",
      eligibleHouseCount: null,
      assessmentPerHouse: null,
      snapshotAt: null,
    });
    live.assessments = [];
    live.payments = [];
    expect((await getChiefFundReport("f")).metrics).toMatchObject({
      hasFrozenAssessments: false,
      expectedHouseholdAssessmentTotal: null,
    });
    live.assessments = fixture().assessments;
    await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
      FundReportIntegrityError,
    );
  });

  it("rejects unpaid CLOSED snapshots and accepts fully covered CLOSED snapshots", async () => {
    live.fund.status = "CLOSED";
    await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
      FundReportIntegrityError,
    );
    live.payments = live.assessments.map((a, i) => ({
      id: `p${i}`,
      fundId: "f",
      villageId: "v",
      houseId: a.houseId,
      fundHouseAssessmentId: a.id,
      amount: 1_001,
      status: "ACCEPTED",
    }));
    expect((await getChiefFundReport("f")).metrics.isComplete).toBe(true);
  });

  it.each([{ page: 0 }, { page: 1.5 }, { pageSize: 101 }, { pageSize: 0 }])(
    "rejects invalid display pagination %j",
    async (options) => {
      await expect(getChiefFundReport("f", options)).rejects.toBeInstanceOf(
        RangeError,
      );
      expect(m.transaction).not.toHaveBeenCalled();
    },
  );

  it("propagates database errors without returning partial metrics", async () => {
    const error = new Error("database unavailable");
    m.payments.mockRejectedValue(error);
    await expect(getChiefFundReport("f")).rejects.toBe(error);
  });
});

// These exercise reader boundaries and snapshot assembly, not a second copy of
// the pure calculator's arithmetic suite. Every case starts from beforeEach.
describe("H2 deterministic transaction and snapshot boundaries", () => {
  it("uses defaults and makes only the expected reads after the READ ONLY statement", async () => {
    const report = await getChiefFundReport("f");
    expect(report.assessmentPage).toMatchObject({
      page: 1,
      pageSize: 25,
      total: 100,
      totalPages: 4,
    });
    expect(report.assessmentPage.rows).toHaveLength(25);
    expect(report.assessmentPage.rows[0]).toMatchObject({
      id: "a0",
      paid: true,
      acceptedCollectionAmount: 1_001,
    });
    expect(m.transaction).toHaveBeenCalledTimes(1);
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
      maxWait: 2000,
      timeout: 5000,
    });
    // No write delegates or lock helpers are supplied. An accidental use fails.
    expect(m.readOnly).toHaveBeenCalledTimes(1);
    expect(m.readOnly.mock.calls[0][0].join("")).toBe(
      "SET TRANSACTION READ ONLY",
    );
    for (const read of [m.user, m.fund, m.assessments, m.payments]) {
      expect(read).toHaveBeenCalledTimes(1);
      expect(m.readOnly.mock.invocationCallOrder[0]).toBeLessThan(
        read.mock.invocationCallOrder[0],
      );
    }
    expect(m.user.mock.invocationCallOrder[0]).toBeLessThan(
      m.fund.mock.invocationCallOrder[0],
    );
    expect(m.fund.mock.invocationCallOrder[0]).toBeLessThan(
      m.assessments.mock.invocationCallOrder[0],
    );
    expect(m.assessments.mock.invocationCallOrder[0]).toBeLessThan(
      m.payments.mock.invocationCallOrder[0],
    );
  });

  it("does not read anything if READ ONLY setup fails", async () => {
    const failure = new Error("cannot set transaction mode");
    m.readOnly.mockRejectedValue(failure);
    await expect(getChiefFundReport("f")).rejects.toBe(failure);
    expect(m.user).not.toHaveBeenCalled();
    expectNoFinancialReads();
  });

  it.each(["user", "fund", "assessments", "payments"] as const)(
    "propagates %s read failures without a report",
    async (operation) => {
      const failure = new Error(`${operation} failed`);
      m[operation].mockRejectedValue(failure);
      await expect(getChiefFundReport("f")).rejects.toBe(failure);
    },
  );

  it("propagates a transaction/commit failure after executing the reader callback", async () => {
    const failure = new Error("transaction failed at completion");
    m.transaction.mockImplementation(
      async (body: (client: typeof tx) => Promise<unknown>) => {
        visible = structuredClone(live);
        await body(tx);
        throw failure;
      },
    );
    await expect(getChiefFundReport("f")).rejects.toBe(failure);
    expect(m.payments).toHaveBeenCalledTimes(1);
  });

  it.each(["PENDING", "REJECTED", "REMOVED", null])(
    "rejects actor membership %s before financial reads",
    async (membershipStatus) => {
      Object.assign(live.actor, { membershipStatus });
      await expect(getChiefFundReport("f")).rejects.toMatchObject({
        path: "/forbidden",
      });
      expectNoFinancialReads();
    },
  );

  it.each([null, { status: "DEACTIVATED" }])(
    "rejects unavailable/inactive actor village %j before financial reads",
    async (village) => {
      Object.assign(live.actor, { village });
      await expect(getChiefFundReport("f")).rejects.toMatchObject({
        path: "/forbidden",
      });
      expectNoFinancialReads();
    },
  );

  it("returns the identical notFound response for an existing foreign fund and a missing fund", async () => {
    const foreign = { ...live.fund, id: "foreign-fund", villageId: "foreign" };
    m.fund.mockImplementation(
      async ({ where }: { where: { id: string; villageId: string } }) =>
        [visible.fund, foreign].find(
          (fund) => fund.id === where.id && fund.villageId === where.villageId,
        ) ?? null,
    );
    for (const id of [foreign.id, "missing-fund"]) {
      await expect(getChiefFundReport(id)).rejects.toMatchObject({
        message: "not found",
        digest: "TEST_NOT_FOUND",
      });
      expect(m.fund).toHaveBeenLastCalledWith(
        expect.objectContaining({ where: { id, villageId: "v" } }),
      );
    }
    expect(m.assessments).not.toHaveBeenCalled();
    expect(m.payments).not.toHaveBeenCalled();
  });

  it.each(["", " ", "f\0bad"])(
    "rejects invalid fund ID %j before starting the transaction",
    async (fundId) => {
      await expect(getChiefFundReport(fundId)).rejects.toMatchObject({
        digest: "TEST_NOT_FOUND",
      });
      expect(m.transaction).not.toHaveBeenCalled();
      expectNoFinancialReads();
    },
  );

  it("rejects a wrong fund ID returned despite the query predicate", async () => {
    live.fund.id = "other-fund";
    await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
      FundReportIntegrityError,
    );
    expect(m.assessments).not.toHaveBeenCalled();
    expect(m.payments).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid termsVersion %s",
    async (termsVersion) => {
      live.fund.termsVersion = termsVersion;
      await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
        FundReportIntegrityError,
      );
    },
  );

  it.each(["ARCHIVED", "", null])(
    "rejects unsupported Fund status %s",
    async (status) => {
      Object.assign(live.fund, { status });
      await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
        FundReportIntegrityError,
      );
    },
  );

  it.each(["count", "amount", "date", "assessment", "payment"])(
    "rejects a DRAFT with unexpected %s",
    async (kind) => {
      live = draftFixture();
      if (kind === "count") live.fund.eligibleHouseCount = 100;
      if (kind === "amount") live.fund.assessmentPerHouse = 1001;
      if (kind === "date") live.fund.snapshotAt = new Date("2026-11-01");
      if (kind === "assessment") live.assessments = fixture().assessments;
      if (kind === "payment") live.payments = fixture().payments;
      await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
        FundReportIntegrityError,
      );
    },
  );

  it.each([
    null,
    0,
    -1,
    99,
    101,
    100.5,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid frozen count %s", async (eligibleHouseCount) => {
    live.fund.eligibleHouseCount = eligibleHouseCount;
    await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
      FundReportIntegrityError,
    );
  });

  it.each([new Date(NaN), "2026-11-01", null])(
    "rejects invalid frozen snapshotAt %s",
    async (snapshotAt) => {
      Object.assign(live.fund, { snapshotAt });
      await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
        FundReportIntegrityError,
      );
    },
  );

  it.each([null, 0, -1, 1000, 1001.5, NaN, Infinity])(
    "rejects inconsistent frozen assessmentPerHouse %s",
    async (assessmentPerHouse) => {
      live.fund.assessmentPerHouse = assessmentPerHouse;
      await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
        FundReportIntegrityError,
      );
    },
  );

  it.each([
    ["id", ""],
    ["id", " "],
    ["houseId", ""],
    ["houseId", " "],
    ["houseNumberSnapshot", ""],
    ["houseNumberSnapshot", " "],
    ["fundId", "foreign"],
    ["villageId", "foreign"],
    ["assessmentAmount", 0],
    ["assessmentAmount", 1.5],
    ["assessmentAmount", 2],
  ])(
    "rejects malformed assessment %s=%j in an otherwise valid snapshot",
    async (field, value) => {
      live = minimalFrozenFixture();
      Object.assign(live.assessments[1], { [field]: value });
      await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
        FundReportIntegrityError,
      );
    },
  );

  it.each([
    ["id", ""],
    ["id", " "],
    ["fundId", "foreign"],
    ["villageId", "foreign"],
    ["houseId", "h1"],
    ["fundHouseAssessmentId", ""],
    ["fundHouseAssessmentId", "orphan-assessment"],
    ["status", "PENDING"],
    ["status", "REJECTED"],
    ["status", ""],
    ["status", null],
  ])("rejects malformed/orphan payment %s=%j", async (field, value) => {
    Object.assign(live.payments[0], { [field]: value });
    await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
      FundReportIntegrityError,
    );
  });

  it("reports an assessment with only voided history as unpaid", async () => {
    live.payments[0].status = "VOIDED";
    const report = await getChiefFundReport("f");
    expect(report.metrics).toMatchObject({
      acceptedCollectionAmount: 0,
      paidFrozenAssessmentCount: 0,
      unpaidFrozenAssessmentCount: 100,
    });
    expect(report.assessmentPage.rows[0]).toMatchObject({
      paid: false,
      acceptedCollectionAmount: 0,
    });
  });

  it("maps a calculator rejection to an integrity error rather than returning partial metrics", async () => {
    live.payments[0].amount = 1000; // Frozen obligation is 1001; the real calculator rejects it.
    await expect(getChiefFundReport("f")).rejects.toBeInstanceOf(
      FundReportIntegrityError,
    );
  });

  it.each([
    undefined,
    { page: 1, pageSize: 100 },
    { page: 2, pageSize: 60 },
    { page: 5, pageSize: 25 },
  ])(
    "returns the correct display slice and full metrics for %j",
    async (options) => {
      const report = await getChiefFundReport("f", options);
      const page = options?.page ?? 1,
        size = options?.pageSize ?? 25;
      const offset = (page - 1) * size;
      const expected = live.assessments.slice(offset, offset + size);
      expect(report.assessmentPage).toMatchObject({
        page,
        pageSize: size,
        total: 100,
        totalPages: Math.ceil(100 / size),
      });
      expect(report.assessmentPage.rows).toHaveLength(expected.length);
      expected.forEach((row, index) =>
        expect(report.assessmentPage.rows[index].id).toBe(row.id),
      );
      expect(report.metrics).toMatchObject({
        acceptedCollectionAmount: 1_001,
        remainingVillageTarget: 99_000,
        excessCollectionOverVillageTarget: 0,
        expectedHouseholdAssessmentTotal: 100_100,
        outstandingHouseholdObligations: 99_099,
        unpaidFrozenAssessmentCount: 99,
      });
      for (const query of [m.assessments, m.payments]) {
        expect(query).toHaveBeenCalledWith(
          expect.objectContaining({ where: { fundId: "f", villageId: "v" } }),
        );
        expect(query.mock.calls[0][0]).not.toHaveProperty("skip");
        expect(query.mock.calls[0][0]).not.toHaveProperty("take");
      }
    },
  );

  it("returns an empty DRAFT page with absent frozen metrics and one total page", async () => {
    live = draftFixture();
    const report = await getChiefFundReport("f");
    expect(report.assessmentPage).toEqual({
      page: 1,
      pageSize: 25,
      total: 0,
      totalPages: 1,
      rows: [],
    });
    expect(report.metrics).toMatchObject({
      hasFrozenAssessments: false,
      outstandingHouseholdObligations: null,
      isComplete: false,
    });
  });

  it.each([
    { page: -1 },
    { page: NaN },
    { page: Infinity },
    { page: Number.MAX_SAFE_INTEGER + 1 },
    { pageSize: -1 },
    { pageSize: 1.5 },
    { pageSize: NaN },
    { pageSize: Infinity },
    { pageSize: Number.MAX_SAFE_INTEGER + 1 },
    { page: Number.MAX_SAFE_INTEGER, pageSize: 100 },
  ])(
    "rejects unsafe or invalid pagination %j before financial reads",
    async (options) => {
      await expect(getChiefFundReport("f", options)).rejects.toBeInstanceOf(
        RangeError,
      );
      expect(m.transaction).not.toHaveBeenCalled();
      expectNoFinancialReads();
    },
  );
});
