import "server-only";

import {
  calculateFundCollectionBalance,
  validateAssessmentAmount,
  validatePaymentAmount,
  validateVillageTargetAmount,
  type FinancialErrorCode,
} from "./fund-financials";

/** Minimal projection of a frozen assessment and its related payment history. */
export interface ReportingAssessment {
  readonly id: string;
  readonly assessmentAmount: number;
  readonly payments: readonly {
    readonly status: "ACCEPTED" | "VOIDED";
    readonly amount: number;
  }[];
}

export interface FundReportingInput {
  readonly status: "DRAFT" | "ACTIVE" | "CLOSED";
  readonly villageTargetAmount: number;
  readonly assessments: readonly ReportingAssessment[];
}

interface CollectionMetrics {
  villageTargetAmount: number;
  acceptedCollectionAmount: number;
  remainingVillageTarget: number;
  excessCollectionOverVillageTarget: number;
}

/** null means no frozen snapshot exists, rather than zero household obligations. */
export type FundReportingMetrics = CollectionMetrics &
  (
    | {
        hasFrozenAssessments: false;
        expectedHouseholdAssessmentTotal: null;
        roundingSurplus: null;
        outstandingHouseholdObligations: null;
        paidFrozenAssessmentCount: null;
        unpaidFrozenAssessmentCount: null;
        isComplete: false;
      }
    | {
        hasFrozenAssessments: true;
        expectedHouseholdAssessmentTotal: number;
        roundingSurplus: number;
        outstandingHouseholdObligations: number;
        paidFrozenAssessmentCount: number;
        unpaidFrozenAssessmentCount: number;
        /** Coverage only: does not mean CLOSED or authorize a closure write. */
        isComplete: boolean;
      }
  );

export type FundReportingResult =
  | { ok: true; data: FundReportingMetrics }
  | {
      ok: false;
      code:
        | FinancialErrorCode
        | "INVALID_REPORTING_SNAPSHOT"
        | "UNSAFE_REPORTING_TOTAL";
      error: string;
    };

/**
 * Pure calculation over the COMPLETE frozen snapshot of ONE authorized fund.
 * The caller must supply correctly linked assessment/payment relations from a
 * consistent read; filtered/paginated rows cannot establish fund-wide metrics.
 * This function performs no authorization, database access or live-house lookup.
 * It sums stored assessments, never reconstructs obligations from a live count.
 */
export function calculateFundReportingMetrics(
  input: FundReportingInput,
): FundReportingResult {
  const target = validateVillageTargetAmount(input.villageTargetAmount);
  if (!target.ok) return target;

  const invalid = (error: string): FundReportingResult => ({
    ok: false,
    code: "INVALID_REPORTING_SNAPSHOT",
    error,
  });
  if (input.status === "DRAFT") {
    if (input.assessments.length !== 0)
      return invalid("A draft fund cannot have frozen assessments.");
    return {
      ok: true,
      data: {
        villageTargetAmount: target.data,
        acceptedCollectionAmount: 0,
        remainingVillageTarget: target.data,
        excessCollectionOverVillageTarget: 0,
        hasFrozenAssessments: false,
        expectedHouseholdAssessmentTotal: null,
        roundingSurplus: null,
        outstandingHouseholdObligations: null,
        paidFrozenAssessmentCount: null,
        unpaidFrozenAssessmentCount: null,
        isComplete: false,
      },
    };
  }
  if (
    (input.status !== "ACTIVE" && input.status !== "CLOSED") ||
    input.assessments.length === 0
  ) {
    return invalid("An activated fund requires a nonempty frozen snapshot.");
  }

  let expected = BigInt(0),
    collected = BigInt(0),
    outstanding = BigInt(0);
  let paid = 0;
  const ids = new Set<string>();
  for (const assessment of input.assessments) {
    if (!assessment.id.trim() || ids.has(assessment.id))
      return invalid("Assessment IDs must be nonempty and unique.");
    ids.add(assessment.id);
    const amount = validateAssessmentAmount(assessment.assessmentAmount);
    if (!amount.ok) return amount;
    expected += BigInt(amount.data);
    let accepted = false;
    for (const payment of assessment.payments) {
      // Validate historical amounts too, without counting VOIDED money/coverage.
      const validated = validatePaymentAmount({
        paymentAmount: payment.amount,
        assessmentAmount: amount.data,
      });
      if (!validated.ok) return validated;
      if (payment.status === "VOIDED") continue;
      if (payment.status !== "ACCEPTED" || accepted)
        return invalid("An assessment may have at most one accepted payment.");
      accepted = true;
      collected += BigInt(validated.data);
    }
    if (accepted) paid += 1;
    else outstanding += BigInt(amount.data);
  }
  if (expected < BigInt(target.data))
    return invalid(
      "Frozen assessment total cannot be below the village target.",
    );
  if (
    [expected, collected, outstanding].some(
      (amount) => amount > BigInt(Number.MAX_SAFE_INTEGER),
    )
  ) {
    return {
      ok: false,
      code: "UNSAFE_REPORTING_TOTAL",
      error: "Reporting totals exceed the safe integer MMK range.",
    };
  }
  const balance = calculateFundCollectionBalance({
    villageTargetAmount: target.data,
    acceptedCollection: Number(collected),
  });
  if (!balance.ok) return balance;
  const unpaid = input.assessments.length - paid;
  return {
    ok: true,
    data: {
      villageTargetAmount: target.data,
      acceptedCollectionAmount: balance.data.acceptedCollection,
      remainingVillageTarget: balance.data.remainingVillageTarget,
      excessCollectionOverVillageTarget: balance.data.excessCollection,
      hasFrozenAssessments: true,
      expectedHouseholdAssessmentTotal: Number(expected),
      roundingSurplus: Number(expected - BigInt(target.data)),
      outstandingHouseholdObligations: Number(outstanding),
      paidFrozenAssessmentCount: paid,
      unpaidFrozenAssessmentCount: unpaid,
      isComplete: unpaid === 0,
    },
  };
}
