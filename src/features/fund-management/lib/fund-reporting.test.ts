import { describe, expect, it } from "vitest";
import { calculateFundAssessment } from "./fund-financials";
import {
  calculateFundReportingMetrics,
  type FundReportingInput,
  type ReportingAssessment,
} from "./fund-reporting";

function snapshot(target = 100_001, count = 100): FundReportingInput {
  const calculation = calculateFundAssessment({
    villageTargetAmount: target,
    eligibleHouseCount: count,
  });
  if (!calculation.ok) throw new Error(calculation.error);
  return {
    status: "ACTIVE",
    villageTargetAmount: target,
    assessments: Array.from({ length: count }, (_, i) => ({
      id: `assessment-${i}`,
      assessmentAmount: calculation.data.assessmentPerHouse,
      payments: [],
    })),
  };
}

function metrics(input: FundReportingInput) {
  const result = calculateFundReportingMetrics(input);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

function withPayments(
  input: FundReportingInput,
  history: ReportingAssessment["payments"],
  index = 0,
): FundReportingInput {
  return {
    ...input,
    assessments: input.assessments.map((row, i) =>
      i === index ? { ...row, payments: history } : row,
    ),
  };
}

describe("frozen fund reporting metrics", () => {
  it("reports normal expected assessments with zero collection and every obligation outstanding", () => {
    expect(metrics(snapshot(100_000))).toEqual({
      villageTargetAmount: 100_000,
      expectedHouseholdAssessmentTotal: 100_000,
      roundingSurplus: 0,
      acceptedCollectionAmount: 0,
      remainingVillageTarget: 100_000,
      excessCollectionOverVillageTarget: 0,
      outstandingHouseholdObligations: 100_000,
      paidFrozenAssessmentCount: 0,
      unpaidFrozenAssessmentCount: 100,
      hasFrozenAssessments: true,
      isComplete: false,
    });
  });

  it("reports the frozen rounding surplus without changing assessments", () => {
    expect(metrics(snapshot())).toMatchObject({
      villageTargetAmount: 100_001,
      expectedHouseholdAssessmentTotal: 100_100,
      roundingSurplus: 99,
      outstandingHouseholdObligations: 100_100,
    });
  });

  it.each(["ACTIVE", "CLOSED"] as const)(
    "reports full coverage for a fully paid %s fund",
    (status) => {
      const input = snapshot();
      expect(
        metrics({
          ...input,
          status,
          assessments: input.assessments.map((row) => ({
            ...row,
            payments: [{ status: "ACCEPTED", amount: row.assessmentAmount }],
          })),
        }),
      ).toMatchObject({
        expectedHouseholdAssessmentTotal: 100_100,
        acceptedCollectionAmount: 100_100,
        remainingVillageTarget: 0,
        excessCollectionOverVillageTarget: 99,
        outstandingHouseholdObligations: 0,
        paidFrozenAssessmentCount: 100,
        unpaidFrozenAssessmentCount: 0,
        isComplete: true,
      });
    },
  );

  it("does not discharge other households when one household overpays below the village target", () => {
    expect(
      metrics(
        withPayments(snapshot(), [{ status: "ACCEPTED", amount: 2_000 }]),
      ),
    ).toMatchObject({
      acceptedCollectionAmount: 2_000,
      remainingVillageTarget: 98_001,
      outstandingHouseholdObligations: 99_099,
      paidFrozenAssessmentCount: 1,
      unpaidFrozenAssessmentCount: 99,
      isComplete: false,
    });
  });

  it("mandatory example: target attainment leaves 99 unpaid frozen assessments", () => {
    const input = snapshot();
    expect(
      input.assessments.every((row) => row.assessmentAmount === 1_001),
    ).toBe(true);
    expect(
      metrics(withPayments(input, [{ status: "ACCEPTED", amount: 100_001 }])),
    ).toEqual({
      villageTargetAmount: 100_001,
      expectedHouseholdAssessmentTotal: 100_100,
      roundingSurplus: 99,
      acceptedCollectionAmount: 100_001,
      remainingVillageTarget: 0,
      excessCollectionOverVillageTarget: 0,
      outstandingHouseholdObligations: 99_099,
      paidFrozenAssessmentCount: 1,
      unpaidFrozenAssessmentCount: 99,
      hasFrozenAssessments: true,
      isComplete: false,
    });
  });

  it("excess over the target also cannot settle another assessment", () => {
    expect(
      metrics(
        withPayments(snapshot(), [{ status: "ACCEPTED", amount: 200_000 }]),
      ),
    ).toMatchObject({
      excessCollectionOverVillageTarget: 99_999,
      outstandingHouseholdObligations: 99_099,
      unpaidFrozenAssessmentCount: 99,
      isComplete: false,
    });
  });

  it("excludes a voided payment from both collection and household coverage", () => {
    expect(
      metrics(
        withPayments(snapshot(), [{ status: "VOIDED", amount: 100_001 }]),
      ),
    ).toMatchObject({
      acceptedCollectionAmount: 0,
      remainingVillageTarget: 100_001,
      outstandingHouseholdObligations: 100_100,
      paidFrozenAssessmentCount: 0,
      isComplete: false,
    });
  });

  it("counts only the accepted replacement across repeated corrections, regardless of history order", () => {
    const history: ReportingAssessment["payments"] = [
      { status: "VOIDED", amount: 100_001 },
      { status: "ACCEPTED", amount: 1_500 },
      { status: "VOIDED", amount: 2_000 },
    ];
    const input = snapshot(1_001, 1);
    const expected = {
      acceptedCollectionAmount: 1_500,
      excessCollectionOverVillageTarget: 499,
      outstandingHouseholdObligations: 0,
      paidFrozenAssessmentCount: 1,
      isComplete: true,
    };
    expect(metrics(withPayments(input, history))).toMatchObject(expected);
    expect(metrics(withPayments(input, [...history].reverse()))).toMatchObject(
      expected,
    );
  });

  it("does not fabricate a DRAFT snapshot or claim vacuous completion", () => {
    expect(
      metrics({
        status: "DRAFT",
        villageTargetAmount: 100_001,
        assessments: [],
      }),
    ).toEqual({
      villageTargetAmount: 100_001,
      acceptedCollectionAmount: 0,
      remainingVillageTarget: 100_001,
      excessCollectionOverVillageTarget: 0,
      hasFrozenAssessments: false,
      expectedHouseholdAssessmentTotal: null,
      roundingSurplus: null,
      outstandingHouseholdObligations: null,
      paidFrozenAssessmentCount: null,
      unpaidFrozenAssessmentCount: null,
      isComplete: false,
    });
  });

  it("preserves exact single-MMK rounding and collection above PostgreSQL Int range", () => {
    const input = snapshot(1_000_000_000, 1_000);
    expect(
      metrics({
        ...input,
        assessments: input.assessments.map((row, i) => ({
          ...row,
          payments: i < 999 ? [{ status: "ACCEPTED", amount: 9_999_999 }] : [],
        })),
      }),
    ).toMatchObject({
      expectedHouseholdAssessmentTotal: 1_000_000_000,
      acceptedCollectionAmount: 9_989_999_001,
      excessCollectionOverVillageTarget: 8_989_999_001,
      outstandingHouseholdObligations: 1_000_000,
      unpaidFrozenAssessmentCount: 1,
    });
    expect(metrics(snapshot(10, 3))).toMatchObject({
      expectedHouseholdAssessmentTotal: 12,
      roundingSurplus: 2,
    });
    expect(
      metrics(
        withPayments(snapshot(1, 3), [{ status: "ACCEPTED", amount: 1 }]),
      ),
    ).toMatchObject({
      expectedHouseholdAssessmentTotal: 3,
      roundingSurplus: 2,
      outstandingHouseholdObligations: 2,
    });
  });

  it.each(["ACTIVE", "CLOSED"] as const)(
    "rejects missing frozen assessments for %s",
    (status) => {
      expect(
        calculateFundReportingMetrics({
          status,
          villageTargetAmount: 1_000,
          assessments: [],
        }),
      ).toMatchObject({ ok: false, code: "INVALID_REPORTING_SNAPSHOT" });
    },
  );

  it("rejects assessments on a draft", () => {
    expect(
      calculateFundReportingMetrics({ ...snapshot(), status: "DRAFT" }),
    ).toMatchObject({ ok: false, code: "INVALID_REPORTING_SNAPSHOT" });
  });

  it("rejects duplicate assessment IDs in an otherwise valid snapshot", () => {
    expect(
      calculateFundReportingMetrics({
        status: "ACTIVE",
        villageTargetAmount: 2_000,
        assessments: [
          { id: "assessment-1", assessmentAmount: 1_000, payments: [] },
          { id: "assessment-1", assessmentAmount: 1_000, payments: [] },
        ],
      }),
    ).toEqual({
      ok: false,
      code: "INVALID_REPORTING_SNAPSHOT",
      error: "Assessment IDs must be nonempty and unique.",
    });
  });

  it("accepts the same valid amounts with distinct assessment IDs", () => {
    expect(
      metrics({
        status: "ACTIVE",
        villageTargetAmount: 2_000,
        assessments: [
          { id: "assessment-1", assessmentAmount: 1_000, payments: [] },
          { id: "assessment-2", assessmentAmount: 1_000, payments: [] },
        ],
      }),
    ).toMatchObject({
      expectedHouseholdAssessmentTotal: 2_000,
      roundingSurplus: 0,
      acceptedCollectionAmount: 0,
      outstandingHouseholdObligations: 2_000,
      paidFrozenAssessmentCount: 0,
      unpaidFrozenAssessmentCount: 2,
      isComplete: false,
    });
  });

  it("rejects duplicate accepted payments within one otherwise valid assessment", () => {
    const input: FundReportingInput = {
      status: "ACTIVE",
      villageTargetAmount: 1_000,
      assessments: [
        { id: "assessment-1", assessmentAmount: 1_000, payments: [] },
      ],
    };
    const payment = { status: "ACCEPTED", amount: 1_000 } as const;
    expect(metrics(withPayments(input, [payment]))).toMatchObject({
      acceptedCollectionAmount: 1_000,
      paidFrozenAssessmentCount: 1,
      isComplete: true,
    });
    expect(
      calculateFundReportingMetrics(withPayments(input, [payment, payment])),
    ).toEqual({
      ok: false,
      code: "INVALID_REPORTING_SNAPSHOT",
      error: "An assessment may have at most one accepted payment.",
    });
  });

  it("preserves partial-payment rejection instead of treating an invalid payment as paid", () => {
    expect(
      calculateFundReportingMetrics(
        withPayments(snapshot(), [{ status: "ACCEPTED", amount: 1_000 }]),
      ),
    ).toMatchObject({ ok: false, code: "PAYMENT_BELOW_ASSESSMENT" });
  });

  it.each([0.1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects noninteger or unsafe payment amount %s",
    (amount) => {
      expect(
        calculateFundReportingMetrics(
          withPayments(snapshot(), [{ status: "ACCEPTED", amount }]),
        ),
      ).toMatchObject({ ok: false, code: "INVALID_PAYMENT" });
    },
  );

  it("rejects invalid targets, assessment amounts and under-target snapshots", () => {
    expect(
      calculateFundReportingMetrics({ ...snapshot(), villageTargetAmount: 0 }),
    ).toMatchObject({ ok: false, code: "INVALID_VILLAGE_TARGET" });
    expect(
      calculateFundReportingMetrics({
        ...snapshot(),
        assessments: [{ id: "a", assessmentAmount: 1.5, payments: [] }],
      }),
    ).toMatchObject({ ok: false, code: "INVALID_ASSESSMENT" });
    expect(
      calculateFundReportingMetrics({
        ...snapshot(),
        assessments: [{ id: "a", assessmentAmount: 1, payments: [] }],
      }),
    ).toMatchObject({ ok: false, code: "INVALID_REPORTING_SNAPSHOT" });
  });

  it("does not mutate frozen input or payment history", () => {
    const input = withPayments(snapshot(), [
      { status: "ACCEPTED", amount: 1_001 },
    ]);
    const before = structuredClone(input);
    for (const row of input.assessments) {
      row.payments.forEach(Object.freeze);
      Object.freeze(row.payments);
      Object.freeze(row);
    }
    Object.freeze(input.assessments);
    Object.freeze(input);
    metrics(input);
    expect(input).toEqual(before);
  });
});
