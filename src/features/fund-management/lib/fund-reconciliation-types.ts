import type { FundReportingMetrics } from "./fund-reporting";
export type CheckOutcome = "PASS" | "DISCREPANCY" | "UNVERIFIED" | "NOT_APPLICABLE";
export type ReconciliationCategory = "assessments" | "payments" | "receipts" | "lifecycle" | "audit";
export interface ReconciliationFinding {
  category: ReconciliationCategory;
  outcome: "DISCREPANCY" | "UNVERIFIED";
  code: string;
  recordId?: string;
  expected?: string | number;
  observed?: string | number;
}
export interface ReconciliationFund {
  id: string; villageId: string; name: string; status: string; villageTargetAmount: number;
  eligibleHouseCount: number | null; assessmentPerHouse: number | null; snapshotAt: Date | null;
  termsVersion: number; endDate: Date; closedAt: Date | null; closedByUserId: string | null;
}
export interface ReconciliationAssessment { id: string; fundId: string; villageId: string; houseId: string; houseNumberSnapshot: string; assessmentAmount: number }
export interface ReconciliationPayment { id: string; fundId: string; villageId: string; houseId: string; fundHouseAssessmentId: string; amount: number; status: string; voidReason: string | null; collectorUserId: string | null }
export interface ReconciliationReceipt { id: string; villageId: string; paymentId: string; receiptNumber: string; status: string }
export interface ReconciliationExtension { id: string; fundId: string; villageId: string; previousEndDate: Date; newEndDate: Date; previousTermsVersion: number; newTermsVersion: number; changedByUserId: string; changedAt: Date; reason: string }
export interface ReconciliationAudit { id: string; fundId: string | null; villageId: string | null; entityType: string; entityId: string | null; actionType: string; actorUserId: string | null; metadata: unknown }
export interface ReconciliationDataset<T> { rows: readonly T[]; complete: boolean }
export interface ReconciliationInput {
  fund: ReconciliationFund;
  assessments?: ReconciliationDataset<ReconciliationAssessment>;
  payments?: ReconciliationDataset<ReconciliationPayment>;
  receipts?: ReconciliationDataset<ReconciliationReceipt>;
  extensions?: ReconciliationDataset<ReconciliationExtension>;
  audits?: ReconciliationDataset<ReconciliationAudit>;
}
export interface FundReconciliationResult {
  fund: { id: string; name: string; termsVersion: number };
  checks: Record<ReconciliationCategory, CheckOutcome>;
  findings: ReconciliationFinding[];
  metrics: FundReportingMetrics | null;
  clean: boolean;
}
