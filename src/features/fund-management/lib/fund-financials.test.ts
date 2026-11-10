import { describe, expect, it } from "vitest";

import {
  calculateFundAssessment,
  calculateFundCollectionBalance,
  MAX_ASSESSMENT_MMK,
  MAX_PAYMENT_MMK,
  MAX_VILLAGE_TARGET_MMK,
  parseMmkAmount,
  validateAssessmentAmount,
  validatePaymentAmount,
  validateVillageTargetAmount,
} from "./fund-financials";

const invalidIntegers = [-1, 0, 0.5, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1];

describe("MMK input boundaries", () => {
  it.each(["", " ", " 1", "1\n", "-1", "0", "1.5", "1.0", "1e3", "+1", "1,000", "Infinity", "NaN", "9007199254740992"])(
    "rejects invalid integer text %j",
    (raw) => expect(parseMmkAmount(raw).ok).toBe(false),
  );

  it.each([1, 1000, Number.MAX_SAFE_INTEGER])("parses exact safe integer %s", (amount) => {
    expect(parseMmkAmount(String(amount))).toEqual({ ok: true, data: amount });
  });

  it.each(invalidIntegers)("rejects invalid village target %s", (amount) => {
    expect(validateVillageTargetAmount(amount).ok).toBe(false);
  });

  it("retains the existing village target cap without treating it as a payment cap", () => {
    expect(validateVillageTargetAmount(MAX_VILLAGE_TARGET_MMK)).toEqual({ ok: true, data: 1_000_000_000 });
    expect(validateVillageTargetAmount(MAX_VILLAGE_TARGET_MMK + 1).ok).toBe(false);
    expect(validateVillageTargetAmount(Number.MAX_SAFE_INTEGER).ok).toBe(false);
  });

  it.each(invalidIntegers)("rejects invalid assessment %s", (amount) => {
    expect(validateAssessmentAmount(amount).ok).toBe(false);
  });
});

describe("uniform fund assessments", () => {
  it("calculates the approved example, including total assessments and surplus", () => {
    expect(calculateFundAssessment({ villageTargetAmount: 100_001, eligibleHouseCount: 100 })).toEqual({
      ok: true,
      data: {
        villageTargetAmount: 100_001,
        eligibleHouseCount: 100,
        assessmentPerHouse: 1_001,
        totalAssessments: 100_100,
        roundingSurplus: 99,
      },
    });
  });

  it.each([
    [100_000, 100, 1_000, 100_000, 0],
    [1, 1, 1, 1, 0],
    [1, 100, 1, 100, 99],
    [10, 3, 4, 12, 2],
    [MAX_ASSESSMENT_MMK, 1, MAX_ASSESSMENT_MMK, MAX_ASSESSMENT_MMK, 0],
    [MAX_VILLAGE_TARGET_MMK, 100, MAX_ASSESSMENT_MMK, MAX_VILLAGE_TARGET_MMK, 0],
    [1, Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1],
  ])("ceiling division for target %s and count %s", (target, houses, assessment, total, surplus) => {
    expect(calculateFundAssessment({ villageTargetAmount: target, eligibleHouseCount: houses })).toEqual({
      ok: true,
      data: {
        villageTargetAmount: target,
        eligibleHouseCount: houses,
        assessmentPerHouse: assessment,
        totalAssessments: total,
        roundingSurplus: surplus,
      },
    });
  });

  it("rejects zero eligible houses", () => {
    expect(calculateFundAssessment({ villageTargetAmount: 100_001, eligibleHouseCount: 0 })).toMatchObject({
      ok: false, code: "NO_ELIGIBLE_HOUSES",
    });
  });

  it.each([-1, 0.5, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid house count %s", (eligibleHouseCount) => {
      expect(calculateFundAssessment({ villageTargetAmount: 100, eligibleHouseCount })).toMatchObject({
        ok: false, code: "INVALID_ELIGIBLE_HOUSE_COUNT",
      });
    },
  );

  it.each(invalidIntegers)("rejects invalid target %s before calculating", (villageTargetAmount) => {
    expect(calculateFundAssessment({ villageTargetAmount, eligibleHouseCount: 100 }).ok).toBe(false);
  });

  it.each([[10_000_001, 1], [20_000_000, 1], [20_000_001, 2]])(
    "rejects excessive assessment for %s / %s without clamping", (villageTargetAmount, eligibleHouseCount) => {
      expect(calculateFundAssessment({ villageTargetAmount, eligibleHouseCount })).toMatchObject({
        ok: false, code: "ASSESSMENT_EXCEEDS_MAXIMUM",
      });
    },
  );

  it("keeps an assessment distinct from the village target during payment validation", () => {
    const result = calculateFundAssessment({ villageTargetAmount: 100_001, eligibleHouseCount: 100 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(validatePaymentAmount({ paymentAmount: 1_000, assessmentAmount: result.data.assessmentPerHouse })).toMatchObject({
      ok: false, code: "PAYMENT_BELOW_ASSESSMENT",
    });
    expect(validatePaymentAmount({ paymentAmount: 1_001, assessmentAmount: result.data.assessmentPerHouse }).ok).toBe(true);
  });
});

describe("payment amounts", () => {
  it.each([1_000, 1_500, MAX_PAYMENT_MMK])("accepts payment %s against 1000", (paymentAmount) => {
    expect(validatePaymentAmount({ paymentAmount, assessmentAmount: 1_000 })).toEqual({ ok: true, data: paymentAmount });
  });

  it("rejects partial payment", () => {
    expect(validatePaymentAmount({ paymentAmount: 999, assessmentAmount: 1_000 })).toMatchObject({
      ok: false, code: "PAYMENT_BELOW_ASSESSMENT",
    });
  });

  it("accepts the maximum assessment paid exactly", () => {
    expect(validatePaymentAmount({ paymentAmount: MAX_PAYMENT_MMK, assessmentAmount: MAX_ASSESSMENT_MMK }).ok).toBe(true);
  });

  it.each([MAX_PAYMENT_MMK + 1, Number.MAX_SAFE_INTEGER])("rejects payment above cap %s", (paymentAmount) => {
    expect(validatePaymentAmount({ paymentAmount, assessmentAmount: 1 })).toMatchObject({
      ok: false, code: "PAYMENT_EXCEEDS_MAXIMUM",
    });
  });

  it.each(invalidIntegers)("rejects invalid payment %s", (paymentAmount) => {
    expect(validatePaymentAmount({ paymentAmount, assessmentAmount: 1 })).toMatchObject({ ok: false, code: "INVALID_PAYMENT" });
  });

  it.each([...invalidIntegers, MAX_ASSESSMENT_MMK + 1])("rejects invalid assessment context %s", (assessmentAmount) => {
    expect(validatePaymentAmount({ paymentAmount: MAX_PAYMENT_MMK, assessmentAmount }).ok).toBe(false);
  });
});

describe("collection balance", () => {
  it.each([
    [0, 100_001, 0],
    [40_000, 60_001, 0],
    [100_001, 0, 0],
    [100_100, 0, 99],
    [20_000_000, 0, 19_899_999],
    [Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER - 100_001],
  ])("calculates remaining/excess for collection %s", (acceptedCollection, remainingVillageTarget, excessCollection) => {
    expect(calculateFundCollectionBalance({ villageTargetAmount: 100_001, acceptedCollection })).toEqual({
      ok: true,
      data: { villageTargetAmount: 100_001, acceptedCollection, remainingVillageTarget, excessCollection },
    });
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid aggregate %s", (acceptedCollection) => {
    expect(calculateFundCollectionBalance({ villageTargetAmount: 100_001, acceptedCollection })).toMatchObject({
      ok: false, code: "INVALID_ACCEPTED_COLLECTION",
    });
  });

  it.each(invalidIntegers)("rejects invalid balance target %s", (villageTargetAmount) => {
    expect(calculateFundCollectionBalance({ villageTargetAmount, acceptedCollection: 0 }).ok).toBe(false);
  });
});
