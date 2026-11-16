/** Presentation states describe frozen assessment coverage, not payment history. */
export type HouseholdFundStatus =
  | { state: "NO_HOUSEHOLD" | "NOT_ASSESSED"; assessmentAmount: null; outstandingAmount: null }
  | { state: "UNPAID" | "PAID"; assessmentAmount: number; outstandingAmount: number };

export type AssessedHouseStatus = "NOT_ASSESSED" | "UNPAID" | "PAID";
