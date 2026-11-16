import "server-only";
import { withChiefFundHistorySnapshot } from "./fund-lifecycle-history";
import { reconcileFund } from "./fund-reconciliation";
import type { ReconciliationDataset } from "./fund-reconciliation-types";
export const RECONCILIATION_CAP = 10_000;
const batch = <T>(rows: T[]): ReconciliationDataset<T> => ({ rows: rows.slice(0, RECONCILIATION_CAP), complete: rows.length <= RECONCILIATION_CAP });

/** One Fund, one authorized snapshot. Display pagination never reaches this API. */
export function getChiefFundReconciliation(fundId: string) {
  return withChiefFundHistorySnapshot(fundId, async (tx, fund, villageId) => {
    const scope = { fundId: fund.id, villageId };
    const take = RECONCILIATION_CAP + 1;
    const [assessmentRows, paymentRows, extensionRows] = await Promise.all([
      tx.fundHouseAssessment.findMany({ where: scope, orderBy: { id: "asc" }, take, select: { id: true, fundId: true, villageId: true, houseId: true, houseNumberSnapshot: true, assessmentAmount: true } }),
      tx.payment.findMany({ where: scope, orderBy: { id: "asc" }, take, select: { id: true, fundId: true, villageId: true, houseId: true, fundHouseAssessmentId: true, amount: true, status: true, voidReason: true, collectorUserId: true } }),
      tx.fundEndDateExtension.findMany({ where: scope, orderBy: { id: "asc" }, take, select: { id: true, fundId: true, villageId: true, previousEndDate: true, newEndDate: true, previousTermsVersion: true, newTermsVersion: true, changedByUserId: true, changedAt: true, reason: true } }),
    ]);
    const assessments = batch(assessmentRows); const payments = batch(paymentRows); const extensions = batch(extensionRows);
    const receipts = batch(await tx.receipt.findMany({ where: { villageId, OR: [
      { payment: { is: { fundId: fund.id, villageId } } }, { paymentId: { in: payments.rows.map((row) => row.id) } },
    ] }, orderBy: { id: "asc" }, take, select: { id: true, villageId: true, paymentId: true, receiptNumber: true, status: true } }));
    const audits = batch(await tx.auditLog.findMany({ where: { villageId, OR: [
      { fundId: fund.id }, { entityType: "FUND", entityId: fund.id },
      { entityType: "FUND_HOUSE_ASSESSMENT", entityId: { in: assessments.rows.map((row) => row.id) } },
      { entityType: "PAYMENT", entityId: { in: payments.rows.map((row) => row.id) } },
      { entityType: "RECEIPT", entityId: { in: receipts.rows.map((row) => row.id) } },
      { entityType: "FUND_END_DATE_EXTENSION", entityId: { in: extensions.rows.map((row) => row.id) } },
    ] }, orderBy: { id: "asc" }, take, select: { id: true, villageId: true, fundId: true, entityType: true, entityId: true, actionType: true, actorUserId: true, metadata: true } }));
    // Association coverage depends on all candidate record IDs being available.
    audits.complete = audits.complete && assessments.complete && payments.complete && receipts.complete && extensions.complete;
    return reconcileFund({ fund, assessments, payments, receipts, extensions, audits });
  });
}
