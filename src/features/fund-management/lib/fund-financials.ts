import "server-only";

/** One integer unit is one MMK. Keep the existing village-target input limit. */
export const MAX_VILLAGE_TARGET_MMK = 1_000_000_000;
export const MAX_ASSESSMENT_MMK = 10_000_000;
export const MAX_PAYMENT_MMK = 10_000_000;

export type FinancialErrorCode =
  | "INVALID_MMK_AMOUNT"
  | "INVALID_VILLAGE_TARGET"
  | "INVALID_ELIGIBLE_HOUSE_COUNT"
  | "NO_ELIGIBLE_HOUSES"
  | "INVALID_ASSESSMENT"
  | "ASSESSMENT_EXCEEDS_MAXIMUM"
  | "UNSAFE_TOTAL_ASSESSMENTS"
  | "INVALID_PAYMENT"
  | "PAYMENT_EXCEEDS_MAXIMUM"
  | "PAYMENT_BELOW_ASSESSMENT"
  | "INVALID_ACCEPTED_COLLECTION";

export type FinancialResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: FinancialErrorCode; error: string };

function isPositiveSafeInteger(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount > 0;
}

/** Parse decimal digits only; never round, truncate, or coerce fractional MMK. */
export function parseMmkAmount(raw: string): FinancialResult<number> {
  const amount = Number(raw);
  if (!/^\d+$/.test(raw) || raw.trim() !== raw || !isPositiveSafeInteger(amount)) {
    return {
      ok: false,
      code: "INVALID_MMK_AMOUNT",
      error: "Amount must be a positive safe integer in MMK.",
    };
  }
  return { ok: true, data: amount };
}

export function validateVillageTargetAmount(
  amount: number,
): FinancialResult<number> {
  if (!isPositiveSafeInteger(amount) || amount > MAX_VILLAGE_TARGET_MMK) {
    return {
      ok: false,
      code: "INVALID_VILLAGE_TARGET",
      error: `Village target must be an integer between 1 and ${MAX_VILLAGE_TARGET_MMK} MMK.`,
    };
  }
  return { ok: true, data: amount };
}

export function validateAssessmentAmount(
  amount: number,
): FinancialResult<number> {
  if (!isPositiveSafeInteger(amount)) {
    return {
      ok: false,
      code: "INVALID_ASSESSMENT",
      error: "Assessment must be a positive safe integer in MMK.",
    };
  }
  if (amount > MAX_ASSESSMENT_MMK) {
    return {
      ok: false,
      code: "ASSESSMENT_EXCEEDS_MAXIMUM",
      error: `Assessment must not exceed ${MAX_ASSESSMENT_MMK} MMK.`,
    };
  }
  return { ok: true, data: amount };
}

export interface FundAssessment {
  villageTargetAmount: number;
  eligibleHouseCount: number;
  assessmentPerHouse: number;
  totalAssessments: number;
  roundingSurplus: number;
}

/**
 * Calculate uniform assessments from a VILLAGE target, never from an assessment.
 * The caller supplies the eligible count (active houses with an active member).
 * This pure module neither queries houses nor creates an activation snapshot.
 * Do not adapt legacy Fund.targetAmount here: its stored meaning is ambiguous.
 */
export function calculateFundAssessment(input: {
  villageTargetAmount: number;
  eligibleHouseCount: number;
}): FinancialResult<FundAssessment> {
  const target = validateVillageTargetAmount(input.villageTargetAmount);
  if (!target.ok) return target;

  const count = input.eligibleHouseCount;
  if (!Number.isSafeInteger(count) || count < 0) {
    return {
      ok: false,
      code: "INVALID_ELIGIBLE_HOUSE_COUNT",
      error: "Eligible house count must be a nonnegative safe integer.",
    };
  }
  if (count === 0) {
    return {
      ok: false,
      code: "NO_ELIGIBLE_HOUSES",
      error: "At least one eligible house is required to calculate assessments.",
    };
  }

  // BigInt division and remainder are exact. Constructor syntax supports the
  // project's ES2017 TypeScript target without BigInt literals or config changes.
  const total = BigInt(target.data);
  const houses = BigInt(count);
  const assessment =
    total / houses + (total % houses === BigInt(0) ? BigInt(0) : BigInt(1));
  const validatedAssessment = validateAssessmentAmount(Number(assessment));
  if (!validatedAssessment.ok) return validatedAssessment;

  const totalAssessments = assessment * houses;
  if (totalAssessments > BigInt(Number.MAX_SAFE_INTEGER)) {
    return {
      ok: false,
      code: "UNSAFE_TOTAL_ASSESSMENTS",
      error: "Total assessments exceed the safe integer MMK range.",
    };
  }
  return {
    ok: true,
    data: {
      villageTargetAmount: target.data,
      eligibleHouseCount: count,
      assessmentPerHouse: validatedAssessment.data,
      totalAssessments: Number(totalAssessments),
      roundingSurplus: Number(totalAssessments - total),
    },
  };
}

/** Validate an already calculated assessment directly; no house-count division. */
export function validatePaymentAmount(input: {
  paymentAmount: number;
  assessmentAmount: number;
}): FinancialResult<number> {
  const assessment = validateAssessmentAmount(input.assessmentAmount);
  if (!assessment.ok) return assessment;
  const amount = input.paymentAmount;
  if (!isPositiveSafeInteger(amount)) {
    return {
      ok: false,
      code: "INVALID_PAYMENT",
      error: "Payment must be a positive safe integer in MMK.",
    };
  }
  if (amount > MAX_PAYMENT_MMK) {
    return {
      ok: false,
      code: "PAYMENT_EXCEEDS_MAXIMUM",
      error: `Payment must not exceed ${MAX_PAYMENT_MMK} MMK.`,
    };
  }
  if (amount < assessment.data) {
    return {
      ok: false,
      code: "PAYMENT_BELOW_ASSESSMENT",
      error: `Amount must be at least ${assessment.data.toLocaleString("en")} MMK. Partial payment is not allowed.`,
    };
  }
  return { ok: true, data: amount };
}

export interface FundCollectionBalance {
  villageTargetAmount: number;
  acceptedCollection: number;
  remainingVillageTarget: number;
  excessCollection: number;
}

/** Collection is an accepted-payment aggregate, so zero and totals above one payment's cap are valid. */
export function calculateFundCollectionBalance(input: {
  villageTargetAmount: number;
  acceptedCollection: number;
}): FinancialResult<FundCollectionBalance> {
  const target = validateVillageTargetAmount(input.villageTargetAmount);
  if (!target.ok) return target;
  if (
    !Number.isSafeInteger(input.acceptedCollection) ||
    input.acceptedCollection < 0
  ) {
    return {
      ok: false,
      code: "INVALID_ACCEPTED_COLLECTION",
      error: "Accepted collection must be a nonnegative safe integer in MMK.",
    };
  }
  const difference = BigInt(target.data) - BigInt(input.acceptedCollection);
  return {
    ok: true,
    data: {
      villageTargetAmount: target.data,
      acceptedCollection: input.acceptedCollection,
      remainingVillageTarget: difference > BigInt(0) ? Number(difference) : 0,
      excessCollection: difference < BigInt(0) ? Number(-difference) : 0,
    },
  };
}
