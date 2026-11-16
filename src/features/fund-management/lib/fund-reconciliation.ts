import { calculateFundAssessment, MAX_PAYMENT_MMK, MAX_VILLAGE_TARGET_MMK } from "./fund-financials";
import { calculateFundReportingMetrics } from "./fund-reporting";
import type { FundReportingMetrics, ReportingAssessment } from "./fund-reporting";
import type { CheckOutcome, FundReconciliationResult, ReconciliationCategory, ReconciliationFinding, ReconciliationInput } from "./fund-reconciliation-types";

const categories: ReconciliationCategory[] = ["assessments", "payments", "receipts", "lifecycle", "audit"];
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const day = (date: Date) => date.toISOString().slice(0, 10);
const validDate = (date: Date | null): date is Date => date instanceof Date && Number.isFinite(date.getTime());

/** Diagnostics only. Never discard bad rows to create apparently valid metrics. */
export function reconcileFund(input: ReconciliationInput): FundReconciliationResult {
  const { fund } = input;
  const findings: ReconciliationFinding[] = [];
  const add = (category: ReconciliationCategory, code: string, recordId?: string, expected?: string | number, observed?: string | number) => {
    findings.push({ category, outcome: "DISCREPANCY", code, recordId, expected, observed });
  };
  const complete = {
    assessments: input.assessments?.complete === true, payments: input.payments?.complete === true,
    receipts: input.receipts?.complete === true, lifecycle: input.extensions?.complete === true, audit: input.audits?.complete === true,
  };
  const need = (category: ReconciliationCategory, dependencies: ReconciliationCategory[]) => {
    for (const dependency of dependencies) if (!complete[dependency]) findings.push({ category, outcome: "UNVERIFIED", code: "INPUT_INCOMPLETE", recordId: dependency });
  };
  need("assessments", ["assessments"]); need("payments", ["assessments", "payments"]);
  need("receipts", ["payments", "receipts"]); need("lifecycle", ["assessments", "payments", "lifecycle"]);
  need("audit", categories);
  const assessments = input.assessments?.rows ?? []; const payments = input.payments?.rows ?? [];
  const receipts = input.receipts?.rows ?? []; const extensions = input.extensions?.rows ?? []; const audits = input.audits?.rows ?? [];
  const scoped = (row: { fundId: string | null; villageId: string | null }) => row.fundId === fund.id && row.villageId === fund.villageId;
  const duplicateIds = <T extends { id: string }>(rows: readonly T[], category: ReconciliationCategory) => {
    const seen = new Set<string>();
    for (const row of rows) { if (!row.id.trim() || seen.has(row.id)) add(category, "DUPLICATE_ID", row.id); seen.add(row.id); }
  };
  duplicateIds(assessments, "assessments"); duplicateIds(payments, "payments"); duplicateIds(receipts, "receipts"); duplicateIds(extensions, "lifecycle"); duplicateIds(audits, "audit");
  const byAssessment = new Map(assessments.map((row) => [row.id, row]));
  const byPayment = new Map(payments.map((row) => [row.id, row]));
  const houses = new Set<string>();
  for (const row of assessments) {
    if (!scoped(row) || !row.houseId.trim() || !row.houseNumberSnapshot.trim() || houses.has(row.houseId) || row.assessmentAmount !== fund.assessmentPerHouse) add("assessments", "ASSESSMENT_INVALID", row.id);
    houses.add(row.houseId);
  }
  if (fund.status === "DRAFT") {
    if (fund.eligibleHouseCount !== null || fund.assessmentPerHouse !== null || fund.snapshotAt !== null || assessments.length) add("assessments", "DRAFT_SNAPSHOT_INVALID", fund.id);
    if (payments.length) add("payments", "DRAFT_PAYMENT", fund.id);
    if (extensions.length) add("lifecycle", "DRAFT_EXTENSION", fund.id);
  } else if (fund.status === "ACTIVE" || fund.status === "CLOSED") {
    if (!validDate(fund.snapshotAt) || !Number.isSafeInteger(fund.eligibleHouseCount) || !fund.eligibleHouseCount) add("assessments", "FROZEN_METADATA_INVALID", fund.id);
    if (complete.assessments && fund.eligibleHouseCount !== assessments.length) add("assessments", "ASSESSMENT_COUNT", fund.id, fund.eligibleHouseCount ?? "null", assessments.length);
    const expected = calculateFundAssessment({ villageTargetAmount: fund.villageTargetAmount, eligibleHouseCount: fund.eligibleHouseCount ?? 0 });
    if (!expected.ok || expected.data.assessmentPerHouse !== fund.assessmentPerHouse) add("assessments", "ASSESSMENT_ROUNDING", fund.id);
    if (complete.assessments && expected.ok && assessments.every((row) => Number.isSafeInteger(row.assessmentAmount) && row.assessmentAmount > 0)) {
      const total = assessments.reduce((sum, row) => sum + BigInt(row.assessmentAmount), BigInt(0));
      if (total !== BigInt(expected.data.totalAssessments)) add("assessments", "ASSESSMENT_TOTAL", fund.id, expected.data.totalAssessments, total.toString());
    }
  } else add("assessments", "FUND_STATUS", fund.id);
  const accepted = new Set<string>();
  for (const payment of payments) {
    const assessment = byAssessment.get(payment.fundHouseAssessmentId);
    if (!scoped(payment) || (complete.assessments && (!assessment || payment.houseId !== assessment.houseId))) add("payments", "PAYMENT_LINK", payment.id);
    if (!Number.isSafeInteger(payment.amount) || payment.amount < 1 || payment.amount > MAX_PAYMENT_MMK || (assessment && payment.amount < assessment.assessmentAmount)) add("payments", "PAYMENT_AMOUNT", payment.id);
    if (payment.status === "ACCEPTED") {
      if (accepted.has(payment.fundHouseAssessmentId)) add("payments", "DUPLICATE_ACCEPTED", payment.id);
      accepted.add(payment.fundHouseAssessmentId);
      if (payment.voidReason !== null) add("payments", "VOID_REASON", payment.id);
    } else if (payment.status !== "VOIDED" || !payment.voidReason?.trim()) add("payments", "VOID_REASON", payment.id);
  }
  const receiptPayments = new Set<string>(); const numbers = new Set<string>();
  for (const receipt of receipts) {
    const payment = byPayment.get(receipt.paymentId);
    if (receipt.villageId !== fund.villageId || (complete.payments && !payment) || receiptPayments.has(receipt.paymentId) || !receipt.receiptNumber.trim() || numbers.has(receipt.receiptNumber)) add("receipts", "RECEIPT_LINK", receipt.id);
    receiptPayments.add(receipt.paymentId); numbers.add(receipt.receiptNumber);
    if (!["ACTIVE", "VOIDED"].includes(receipt.status) || (payment && receipt.status !== (payment.status === "ACCEPTED" ? "ACTIVE" : "VOIDED"))) add("receipts", "RECEIPT_STATUS", receipt.id);
  }
  if (complete.receipts) for (const payment of payments) if (!receiptPayments.has(payment.id)) add("receipts", "RECEIPT_MISSING", payment.id);
  let metrics: FundReportingMetrics | null = null;
  if (complete.assessments && complete.payments && !findings.some((f) => ["assessments", "payments"].includes(f.category))) {
    const linked: ReportingAssessment[] = assessments.map((row) => ({ id: row.id, assessmentAmount: row.assessmentAmount, payments: [] }));
    const index = new Map(linked.map((row) => [row.id, row]));
    for (const payment of payments) (index.get(payment.fundHouseAssessmentId)!.payments as { status: "ACCEPTED" | "VOIDED"; amount: number }[]).push({ status: payment.status as "ACCEPTED" | "VOIDED", amount: payment.amount });
    const calculated = calculateFundReportingMetrics({ status: fund.status as "DRAFT" | "ACTIVE" | "CLOSED", villageTargetAmount: fund.villageTargetAmount, assessments: linked });
    if (calculated.ok) metrics = calculated.data; else add("payments", "CALCULATION_INVALID", fund.id, undefined, calculated.code);
  }
  if (!Number.isSafeInteger(fund.termsVersion) || fund.termsVersion < 1 || !validDate(fund.endDate)) add("lifecycle", "VERSION_INVALID", fund.id);
  if (fund.status === "CLOSED") {
    if (!validDate(fund.closedAt) || !fund.closedByUserId) add("lifecycle", "CLOSURE_FIELDS", fund.id);
    if (metrics && !metrics.isComplete) add("lifecycle", "CLOSED_UNPAID", fund.id);
  } else if (fund.closedAt !== null || fund.closedByUserId !== null) add("lifecycle", "CLOSURE_FIELDS", fund.id);
  for (const extension of extensions) if (!scoped(extension) || !validDate(extension.previousEndDate) || !validDate(extension.newEndDate) || !validDate(extension.changedAt) || !Number.isSafeInteger(extension.previousTermsVersion) || extension.newTermsVersion !== extension.previousTermsVersion + 1 || extension.newTermsVersion > fund.termsVersion || !extension.changedByUserId || !extension.reason.trim() || (validDate(extension.previousEndDate) && validDate(extension.newEndDate) && day(extension.previousEndDate) >= day(extension.newEndDate))) add("lifecycle", "EXTENSION_INVALID", extension.id);

  if (fund.status === "CLOSED" && !metrics) findings.push({ category: "lifecycle", outcome: "UNVERIFIED", code: "COVERAGE_UNAVAILABLE", recordId: fund.id });
  if (complete.lifecycle && extensions.length && extensions.every((e) => validDate(e.newEndDate) && validDate(e.previousEndDate))) {
    const ordered = [...extensions].sort((a, b) => a.newTermsVersion - b.newTermsVersion);
    if (ordered.some((e, i) => i > 0 && (e.previousTermsVersion !== ordered[i - 1].newTermsVersion || day(e.previousEndDate) !== day(ordered[i - 1].newEndDate))) || day(ordered[ordered.length - 1].newEndDate) !== (validDate(fund.endDate) ? day(fund.endDate) : "")) add("lifecycle", "EXTENSION_CHAIN", fund.id);
  }
  // Audit rows are indexed once; amounts never contribute to financial totals.
  const eventIndex = new Map<string, typeof audits[number][]>();
  const consumed = new Set<string>();
  for (const audit of audits) {
    const data = object(audit.metadata); const key = `${String(data.event)}:${audit.entityId}`;
    const list = eventIndex.get(key) ?? []; list.push(audit); eventIndex.set(key, list);
    if (!scoped(audit)) add("audit", "AUDIT_SCOPE", audit.id);
    if (!audit.actorUserId) findings.push({ category: "audit", outcome: "UNVERIFIED", code: "ACTOR_UNAVAILABLE", recordId: audit.id });
  }
  const requireEvent = (event: string, entity: string, id: string, action: string, values: Record<string, unknown>, actor?: string | null) => {
    const logs = eventIndex.get(`${event}:${id}`) ?? [];
    if (!logs.length) { if (complete.audit) add("audit", "AUDIT_MISSING", id, event, 0); return; }
    if (logs.length !== 1) add("audit", "AUDIT_DUPLICATE", id, event, logs.length);
    for (const log of logs) {
      consumed.add(log.id); const data = object(log.metadata);
      const mismatch = Object.entries(values).find(([key, value]) => data[key] !== value);
      if (log.entityType !== entity || log.actionType !== action || (actor && log.actorUserId && log.actorUserId !== actor) || mismatch) add("audit", "AUDIT_CONFLICT", log.id,
        mismatch ? `${event}.${mismatch[0]}=${String(mismatch[1])}` : `${event}: ${entity}/${action}, actor=${actor ?? "recorded actor"}`,
        mismatch ? String(data[mismatch[0]]) : `${log.entityType}/${log.actionType}, actor=${log.actorUserId ?? "unavailable"}`);
    }
  };
  requireEvent("DRAFT_CREATED", "FUND", fund.id, "CREATE", { termsVersion: 1 });
  for (const log of eventIndex.get(`DRAFT_CREATED:${fund.id}`) ?? []) {
    const value = object(log.metadata).villageTargetAmount;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > MAX_VILLAGE_TARGET_MMK || (fund.termsVersion === 1 && value !== fund.villageTargetAmount)) add("audit", "AUDIT_CONFLICT", log.id);
  }
  for (const payment of payments) {
    const values = { paymentId: payment.id, houseId: payment.houseId, assessmentId: payment.fundHouseAssessmentId, amount: payment.amount };
    if (!payment.collectorUserId) findings.push({ category: "audit", outcome: "UNVERIFIED", code: "ACTOR_UNAVAILABLE", recordId: payment.id });
    requireEvent("PAYMENT_CREATED", "PAYMENT", payment.id, "CREATE", values, payment.collectorUserId);
    if (payment.status === "VOIDED") requireEvent("PAYMENT_VOIDED", "PAYMENT", payment.id, "VOID", { ...values, reason: payment.voidReason });
  }
  for (const receipt of receipts) {
    requireEvent("RECEIPT_CREATED", "RECEIPT", receipt.id, "CREATE", { paymentId: receipt.paymentId, receiptId: receipt.id, receiptNumber: receipt.receiptNumber }, byPayment.get(receipt.paymentId)?.collectorUserId);
    if (receipt.status === "VOIDED") requireEvent("RECEIPT_VOIDED", "RECEIPT", receipt.id, "VOID", { paymentId: receipt.paymentId, receiptId: receipt.id, ...(byPayment.has(receipt.paymentId) ? { reason: byPayment.get(receipt.paymentId)!.voidReason } : {}) });
  }
  for (const receipt of receipts) {
    const paymentVoid = eventIndex.get(`PAYMENT_VOIDED:${receipt.paymentId}`) ?? [];
    const receiptVoid = eventIndex.get(`RECEIPT_VOIDED:${receipt.id}`) ?? [];
    if (paymentVoid.length === 1 && receiptVoid.length === 1 && paymentVoid[0].actorUserId && receiptVoid[0].actorUserId && paymentVoid[0].actorUserId !== receiptVoid[0].actorUserId) add("audit", "AUDIT_CONFLICT", receipt.id, "Matching void actors");
  }
  // Compare all available creation actors even when persisted collector attribution
  // is unavailable. Historical membership/role does not determine attribution.
  const creationActors = new Map(payments.map((payment) => [payment.id, new Set<string>(payment.collectorUserId ? [payment.collectorUserId] : [])]));
  const byReceipt = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  for (const audit of audits) {
    const event = object(audit.metadata).event;
    const paymentId = event === "RECEIPT_CREATED" ? byReceipt.get(audit.entityId ?? "")?.paymentId
      : event === "PAYMENT_CREATED" || event === "PAYMENT_REPLACED" ? audit.entityId : null;
    if (paymentId && audit.actorUserId) creationActors.get(paymentId)?.add(audit.actorUserId);
  }
  for (const [paymentId, actors] of creationActors) if (actors.size > 1) add("audit", "CREATION_ACTOR_CONFLICT", paymentId, "One consistent creation actor", [...actors].sort().join(", "));
  const predecessor = new Map<string, string>(); const usedPredecessors = new Set<string>();
  for (const payment of payments) {
    const logs = eventIndex.get(`PAYMENT_REPLACED:${payment.id}`) ?? [];
    if (!logs.length) continue;
    const data = object(logs[0].metadata); const prior = typeof data.previousPaymentId === "string" ? byPayment.get(data.previousPaymentId) : undefined;
    requireEvent("PAYMENT_REPLACED", "PAYMENT", payment.id, "CREATE", { paymentId: payment.id, houseId: payment.houseId, assessmentId: payment.fundHouseAssessmentId, amount: payment.amount }, payment.collectorUserId);
    if (!prior) { if (complete.payments) add("audit", "REPLACEMENT_LINK", payment.id); continue; }
    if (prior.id === payment.id || !scoped(prior) || prior.fundHouseAssessmentId !== payment.fundHouseAssessmentId || prior.houseId !== payment.houseId || prior.status !== "VOIDED" || data.reason !== prior.voidReason || usedPredecessors.has(prior.id)) add("audit", "REPLACEMENT_LINK", payment.id);
    predecessor.set(payment.id, prior.id); usedPredecessors.add(prior.id);
  }
  const visited = new Set<string>();
  for (const id of predecessor.keys()) {
    const path = new Set<string>(); let current: string | undefined = id;
    while (current && predecessor.has(current) && !visited.has(current)) {
      if (path.has(current)) { add("audit", "REPLACEMENT_CYCLE", current); break; }
      path.add(current); current = predecessor.get(current);
    }
    for (const member of path) visited.add(member);
  }
  const groups = new Map<string, typeof payments[number][]>();
  for (const payment of payments) { const group = groups.get(payment.fundHouseAssessmentId) ?? []; group.push(payment); groups.set(payment.fundHouseAssessmentId, group); }
  if (complete.payments && complete.audit) for (const assessment of assessments) {
    const members = groups.get(assessment.id) ?? [];
    if (members.length && members.filter((p) => !predecessor.has(p.id)).length !== 1) add("audit", "REPLACEMENT_ROOT", assessment.id);
  }
  const versions = new Map<number, number[]>();
  const version = (number: unknown, kind: number) => { if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1 || number > fund.termsVersion) add("audit", "AUDIT_VERSION", fund.id); else versions.set(number, [...(versions.get(number) ?? []), kind]); };
  version(1, 0);
  for (const audit of audits) {
    const data = object(audit.metadata);
    if (data.event === "DRAFT_UPDATED" && audit.entityId === fund.id) { consumed.add(audit.id); version(data.termsVersion, 0); if (audit.entityType !== "FUND" || audit.actionType !== "UPDATE" || typeof data.villageTargetAmount !== "number" || !Number.isSafeInteger(data.villageTargetAmount) || Number(data.villageTargetAmount) < 1 || Number(data.villageTargetAmount) > MAX_VILLAGE_TARGET_MMK || (fund.status === "DRAFT" && data.termsVersion === fund.termsVersion && data.villageTargetAmount !== fund.villageTargetAmount)) add("audit", "AUDIT_CONFLICT", audit.id); }
  }
  if (fund.status !== "DRAFT") {
    if (!metrics) findings.push({ category: "audit", outcome: "UNVERIFIED", code: "CALCULATION_UNAVAILABLE", recordId: fund.id });
    const logs = eventIndex.get(`FUND_ACTIVATED:${fund.id}`) ?? [];
    const data = object(logs[0]?.metadata); if (logs.length) version(data.termsVersion, 1);
    requireEvent("FUND_ACTIVATED", "FUND", fund.id, "STATUS_CHANGE", { villageTargetAmount: fund.villageTargetAmount, eligibleHouseCount: fund.eligibleHouseCount, assessmentPerHouse: fund.assessmentPerHouse, snapshotAt: validDate(fund.snapshotAt) ? fund.snapshotAt.toISOString() : null,
      ...(metrics ? { totalAssessment: metrics.expectedHouseholdAssessmentTotal, roundingSurplus: metrics.roundingSurplus } : {}) });
  }
  for (const extension of extensions) {
    version(extension.newTermsVersion, 2);
    requireEvent("FUND_EXTENDED", "FUND_END_DATE_EXTENSION", extension.id, "UPDATE", { extensionId: extension.id, previousEndDate: validDate(extension.previousEndDate) ? day(extension.previousEndDate) : null, newEndDate: validDate(extension.newEndDate) ? day(extension.newEndDate) : null, reason: extension.reason, termsVersion: extension.newTermsVersion }, extension.changedByUserId);
  }
  if (fund.status === "CLOSED") { version(fund.termsVersion, 3); requireEvent("FUND_CLOSED", "FUND", fund.id, "STATUS_CHANGE", { closedAt: validDate(fund.closedAt) ? fund.closedAt.toISOString() : null, termsVersion: fund.termsVersion, ...(complete.payments ? { acceptedPaymentCount: payments.filter((p) => p.status === "ACCEPTED").length } : {}) }, fund.closedByUserId); }
  if (complete.audit && complete.lifecycle) {
    const ordered = [...versions].sort(([a], [b]) => a - b);
    const phases = ordered.map(([, kinds]) => kinds[0]);
    const validSequence = ordered.length === fund.termsVersion && !ordered.some(([number, kinds], i) => number !== i + 1 || kinds.length !== 1 || (i > 0 && kinds[0] < phases[i - 1])) &&
      (fund.status === "DRAFT" ? phases.every((kind) => kind === 0)
        : phases.filter((kind) => kind === 1).length === 1 &&
          (fund.status === "ACTIVE" ? !phases.includes(3) : fund.status === "CLOSED" && phases.filter((kind) => kind === 3).length === 1 && phases[phases.length - 1] === 3));
    if (!validSequence) add("audit", "AUDIT_VERSION", fund.id);
    // Activation preserves the last draft target. Earlier draft targets may
    // legitimately differ; compare only a complete, unambiguous version chain.
    if (validSequence && fund.status !== "DRAFT") {
      const activationLogs = eventIndex.get(`FUND_ACTIVATED:${fund.id}`) ?? [];
      const activation = activationLogs[0];
      const activationData = object(activation?.metadata);
      const finalDraftVersion = Number(activationData.termsVersion) - 1;
      const drafts = audits.filter((audit) => audit.entityId === fund.id &&
        ["DRAFT_CREATED", "DRAFT_UPDATED"].includes(String(object(audit.metadata).event)) && object(audit.metadata).termsVersion === finalDraftVersion);
      if (activationLogs.length === 1 && drafts.length === 1 && scoped(activation) && activation.entityType === "FUND" && activation.actionType === "STATUS_CHANGE" &&
          scoped(drafts[0]) && drafts[0].entityType === "FUND" && drafts[0].actionType === (finalDraftVersion === 1 ? "CREATE" : "UPDATE") &&
          Number.isSafeInteger(object(drafts[0].metadata).villageTargetAmount) && Number.isSafeInteger(activationData.villageTargetAmount) &&
          object(drafts[0].metadata).villageTargetAmount !== activationData.villageTargetAmount) {
        add("audit", "AUDIT_CONFLICT", activation.id, `Final draft target=${String(object(drafts[0].metadata).villageTargetAmount)}`, String(activationData.villageTargetAmount));
      }
    }
  }
  // Unknown/orphan evidence is never silently treated as verified. Partial input
  // cannot establish an orphan; it remains unverified instead.
  for (const audit of audits) if (!consumed.has(audit.id)) findings.push({ category: "audit", outcome: categories.every((c) => complete[c]) ? "DISCREPANCY" : "UNVERIFIED", code: "AUDIT_UNMATCHED", recordId: audit.id });
  const checks = Object.fromEntries(categories.map((category) => [category, findings.some((f) => f.category === category && f.outcome === "DISCREPANCY") ? "DISCREPANCY" : findings.some((f) => f.category === category && f.outcome === "UNVERIFIED") ? "UNVERIFIED" : fund.status === "DRAFT" && category === "lifecycle" ? "NOT_APPLICABLE" : "PASS"])) as Record<ReconciliationCategory, CheckOutcome>;
  return { fund: { id: fund.id, name: fund.name, termsVersion: fund.termsVersion }, checks, findings, metrics, clean: Object.values(checks).every((value) => value === "PASS" || value === "NOT_APPLICABLE") };
}
