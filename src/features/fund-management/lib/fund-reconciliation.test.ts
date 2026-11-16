/** Pure fixtures; no database or PostgreSQL verification. */
import { describe, expect, it } from "vitest";
import { reconcileFund } from "./fund-reconciliation";
import type { ReconciliationAudit, ReconciliationInput } from "./fund-reconciliation-types";
const date = new Date("2026-11-01T00:00:00Z");
function fixture(status: "DRAFT" | "ACTIVE" | "CLOSED" = "ACTIVE", paid = true): ReconciliationInput {
  const input: ReconciliationInput = {
    fund: { id: "f", villageId: "v", name: "Fund", status, villageTargetAmount: 1001, eligibleHouseCount: status === "DRAFT" ? null : 1, assessmentPerHouse: status === "DRAFT" ? null : 1001, snapshotAt: status === "DRAFT" ? null : date,
      termsVersion: status === "DRAFT" ? 1 : status === "CLOSED" ? 3 : 2, endDate: new Date("2026-11-30"), closedAt: status === "CLOSED" ? date : null, closedByUserId: status === "CLOSED" ? "chief" : null },
    assessments: { complete: true, rows: status === "DRAFT" ? [] : [{ id: "a", fundId: "f", villageId: "v", houseId: "h", houseNumberSnapshot: "Frozen-H", assessmentAmount: 1001 }] },
    payments: { complete: true, rows: status === "DRAFT" || !paid ? [] : [{ id: "p", fundId: "f", villageId: "v", houseId: "h", fundHouseAssessmentId: "a", amount: 1001, status: "ACCEPTED", voidReason: null, collectorUserId: "collector" }] },
    receipts: { complete: true, rows: status === "DRAFT" || !paid ? [] : [{ id: "r", villageId: "v", paymentId: "p", receiptNumber: "ORIGINAL-1", status: "ACTIVE" }] },
    extensions: { complete: true, rows: [] }, audits: { complete: true, rows: [] },
  };
  input.audits = { complete: true, rows: auditRows(input) }; return input;
}
function auditRows(input: ReconciliationInput): ReconciliationAudit[] {
  const f = input.fund; const rows: ReconciliationAudit[] = [];
  const push = (event: string, entityType: string, entityId: string, actionType: string, metadata: Record<string, unknown>, actorUserId = "chief") => rows.push({ id: `log-${rows.length}`, fundId: f.id, villageId: f.villageId, entityType, entityId, actionType, actorUserId, metadata: { event, ...metadata } });
  push("DRAFT_CREATED", "FUND", f.id, "CREATE", { termsVersion: 1, villageTargetAmount: f.villageTargetAmount });
  if (f.status !== "DRAFT") push("FUND_ACTIVATED", "FUND", f.id, "STATUS_CHANGE", { termsVersion: 2, villageTargetAmount: f.villageTargetAmount, eligibleHouseCount: f.eligibleHouseCount, assessmentPerHouse: f.assessmentPerHouse, snapshotAt: f.snapshotAt?.toISOString(), totalAssessment: Number(f.eligibleHouseCount) * Number(f.assessmentPerHouse), roundingSurplus: Number(f.eligibleHouseCount) * Number(f.assessmentPerHouse) - f.villageTargetAmount });
  for (const p of input.payments?.rows ?? []) {
    const values = { paymentId: p.id, houseId: p.houseId, assessmentId: p.fundHouseAssessmentId, amount: p.amount };
    push("PAYMENT_CREATED", "PAYMENT", p.id, "CREATE", values, "collector");
    if (p.status === "VOIDED") push("PAYMENT_VOIDED", "PAYMENT", p.id, "VOID", { ...values, reason: p.voidReason });
  }
  for (const r of input.receipts?.rows ?? []) {
    push("RECEIPT_CREATED", "RECEIPT", r.id, "CREATE", { paymentId: r.paymentId, receiptId: r.id, receiptNumber: r.receiptNumber }, "collector");
    if (r.status === "VOIDED") push("RECEIPT_VOIDED", "RECEIPT", r.id, "VOID", { paymentId: r.paymentId, receiptId: r.id, reason: input.payments?.rows.find((p) => p.id === r.paymentId)?.voidReason });
  }
  if (f.status === "CLOSED") push("FUND_CLOSED", "FUND", f.id, "STATUS_CHANGE", { termsVersion: f.termsVersion, closedAt: f.closedAt?.toISOString(), acceptedPaymentCount: input.payments?.rows.filter((p) => p.status === "ACCEPTED").length });
  return rows;
}
const codes = (input: ReconciliationInput) => reconcileFund(input).findings.map((f) => f.code);
describe("Fund reconciliation", () => {
  it.each(["DRAFT", "ACTIVE", "CLOSED"] as const)("valid %s reconciles without findings", (status) => {
    const result = reconcileFund(fixture(status)); expect(result.clean).toBe(true); expect(result.findings).toEqual([]);
    if (status === "DRAFT") expect(result.metrics?.outstandingHouseholdObligations).toBeNull();
  });
  it("does not equate target attainment with household completion", () => {
    const input = fixture(); input.fund.villageTargetAmount = 100001; input.fund.eligibleHouseCount = 100;
    input.assessments!.rows = Array.from({ length: 100 }, (_, i) => ({ ...input.assessments!.rows[0], id: `a-${i}`, houseId: `h-${i}` }));
    input.payments!.rows = [{ ...input.payments!.rows[0], amount: 100001, houseId: "h-0", fundHouseAssessmentId: "a-0" }];
    input.audits!.rows = auditRows(input);
    expect(reconcileFund(input)).toMatchObject({ clean: true, metrics: { expectedHouseholdAssessmentTotal: 100100, roundingSurplus: 99, acceptedCollectionAmount: 100001, outstandingHouseholdObligations: 99099, remainingVillageTarget: 0, isComplete: false } });
  });
  it.each(["assessments", "payments", "receipts", "extensions", "audits"] as const)("truncated %s prevents a clean result without inventing missing facts", (key) => {
    const input = fixture(); input[key]!.complete = false; const result = reconcileFund(input);
    expect(result.clean).toBe(false); expect(result.findings.some((f) => f.outcome === "UNVERIFIED")).toBe(true);
    expect(result.metrics === null).toBe(key === "assessments" || key === "payments");
  });
  it("missing input remains unverified; incomplete audits retain trustworthy metrics", () => {
    const input = fixture(); delete input.audits; expect(reconcileFund(input)).toMatchObject({ clean: false, checks: { audit: "UNVERIFIED" }, metrics: { acceptedCollectionAmount: 1001 } });
    delete input.assessments; expect(reconcileFund(input).metrics).toBeNull();
  });
  it.each(["missing", "amount", "duplicate", "link", "partial", "doubleAccepted"])("explains invalid financial rows: %s", (change) => {
    const input = fixture();
    if (change === "missing") input.assessments!.rows = [];
    if (change === "amount") input.assessments!.rows = [{ ...input.assessments!.rows[0], assessmentAmount: 1002 }];
    if (change === "duplicate") input.assessments!.rows = [...input.assessments!.rows, input.assessments!.rows[0]];
    if (change === "link") input.payments!.rows = [{ ...input.payments!.rows[0], fundHouseAssessmentId: "other" }];
    if (change === "partial") input.payments!.rows = [{ ...input.payments!.rows[0], amount: 1000 }];
    if (change === "doubleAccepted") input.payments!.rows = [...input.payments!.rows, { ...input.payments!.rows[0], id: "second" }];
    expect(reconcileFund(input).metrics).toBeNull(); expect(reconcileFund(input).clean).toBe(false);
  });
  it("voided money never counts as accepted or settled coverage", () => {
    const input = fixture(); input.payments!.rows = [{ ...input.payments!.rows[0], status: "VOIDED", voidReason: "Wrong payer" }]; input.receipts!.rows = [{ ...input.receipts!.rows[0], status: "VOIDED" }]; input.audits!.rows = auditRows(input);
    expect(reconcileFund(input)).toMatchObject({ clean: true, metrics: { acceptedCollectionAmount: 0, outstandingHouseholdObligations: 1001, paidFrozenAssessmentCount: 0 } });
  });
  it("replacement annotations do not double count, and predecessor relationships are checked without time inference", () => {
    const input = fixture(); const original = { ...input.payments!.rows[0], status: "VOIDED", voidReason: "Wrong payer" };
    const replacement = { ...original, id: "earlier-looking-id", status: "ACCEPTED", voidReason: null };
    input.payments!.rows = [original, replacement]; input.receipts!.rows = [{ ...input.receipts!.rows[0], status: "VOIDED" }, { ...input.receipts!.rows[0], id: "new-r", receiptNumber: "NEW-2", paymentId: replacement.id }];
    const annotation: ReconciliationAudit = { id: "replacement", fundId: "f", villageId: "v", entityId: replacement.id, entityType: "PAYMENT", actionType: "CREATE", actorUserId: "collector", metadata: { event: "PAYMENT_REPLACED", previousPaymentId: original.id, paymentId: replacement.id, houseId: "h", assessmentId: "a", amount: 1001, reason: original.voidReason } };
    input.audits!.rows = [...auditRows(input), annotation]; expect(reconcileFund(input)).toMatchObject({ clean: true, metrics: { acceptedCollectionAmount: 1001 } });
    input.audits!.rows = auditRows(input); expect(codes(input)).toContain("REPLACEMENT_ROOT");
    input.audits!.rows = [...auditRows(input), { ...annotation, metadata: { ...annotation.metadata as object, previousPaymentId: replacement.id } }]; expect(codes(input)).toContain("REPLACEMENT_LINK"); expect(codes(input)).toContain("REPLACEMENT_CYCLE");
  });
  it.each(["missing", "duplicate", "status", "link"])("receipt discrepancy preserves independent metrics: %s", (change) => {
    const input = fixture();
    if (change === "missing") input.receipts!.rows = [];
    if (change === "duplicate") input.receipts!.rows = [...input.receipts!.rows, { ...input.receipts!.rows[0], id: "second" }];
    if (change === "status") input.receipts!.rows = [{ ...input.receipts!.rows[0], status: "VOIDED" }];
    if (change === "link") input.receipts!.rows = [{ ...input.receipts!.rows[0], paymentId: "missing" }];
    expect(reconcileFund(input)).toMatchObject({ clean: false, metrics: { acceptedCollectionAmount: 1001 }, checks: { receipts: "DISCREPANCY" } });
  });
  it.each(["missing", "duplicate", "malformed", "conflict", "actor", "scope"])("reports audit evidence accurately: %s", (change) => {
    const input = fixture(); const logs = [...input.audits!.rows];
    if (change === "missing") logs.splice(2, 1);
    if (change === "duplicate") logs.push({ ...logs[2], id: "extra" });
    if (change === "malformed") logs[2] = { ...logs[2], metadata: [] };
    if (change === "conflict") logs[2] = { ...logs[2], metadata: { ...logs[2].metadata as object, amount: 999 } };
    if (change === "actor") logs[2] = { ...logs[2], actorUserId: null };
    if (change === "scope") logs[2] = { ...logs[2], fundId: "other" };
    input.audits!.rows = logs; const result = reconcileFund(input); expect(result.clean).toBe(false); expect(result.metrics).not.toBeNull();
    if (change === "actor") expect(result.findings).toContainEqual(expect.objectContaining({ code: "ACTOR_UNAVAILABLE", outcome: "UNVERIFIED" }));
  });
  it("CLOSED unpaid coverage is reported separately", () => {
    const input = fixture("CLOSED", false); expect(codes(input)).toContain("CLOSED_UNPAID");
  });
  it("does not mutate caller inputs", () => {
    const input = fixture(); const before = JSON.stringify(input); reconcileFund(input); expect(JSON.stringify(input)).toBe(before);
  });
});

it("preserves valid old draft targets instead of comparing them with current terms", () => {
  const input = fixture("DRAFT"); input.fund.termsVersion = 2;
  input.audits!.rows = [
    { ...input.audits!.rows[0], metadata: { event: "DRAFT_CREATED", termsVersion: 1, villageTargetAmount: 999 } },
    { ...input.audits!.rows[0], id: "edit", actionType: "UPDATE", metadata: { event: "DRAFT_UPDATED", termsVersion: 2, villageTargetAmount: 1001 } },
  ]; expect(reconcileFund(input).clean).toBe(true);
});
it("valid extension evidence follows persisted dates, versions and actor; conflict is precise", () => {
  const input = fixture(); input.fund.termsVersion = 3; input.fund.endDate = new Date("2026-12-31");
  input.extensions!.rows = [{ id: "e", fundId: "f", villageId: "v", previousEndDate: new Date("2026-11-30"), newEndDate: input.fund.endDate, previousTermsVersion: 2, newTermsVersion: 3, changedAt: date, changedByUserId: "former-chief", reason: "Unpaid at extension time" }];
  input.audits!.rows = [...auditRows(input), { id: "extension", fundId: "f", villageId: "v", entityId: "e", entityType: "FUND_END_DATE_EXTENSION", actionType: "UPDATE", actorUserId: "former-chief", metadata: { event: "FUND_EXTENDED", extensionId: "e", previousEndDate: "2026-11-30", newEndDate: "2026-12-31", termsVersion: 3, reason: "Unpaid at extension time" } }];
  expect(reconcileFund(input).clean).toBe(true);
  input.extensions!.rows = [{ ...input.extensions!.rows[0], reason: "Different" }];
  expect(reconcileFund(input).findings).toContainEqual(expect.objectContaining({ code: "AUDIT_CONFLICT", expected: "FUND_EXTENDED.reason=Different" }));
});
it("closure evidence conflicts do not replace authoritative closure facts", () => {
  const input = fixture("CLOSED"); input.audits!.rows = input.audits!.rows.map((r) => r.entityType === "FUND" && r.actionType === "STATUS_CHANGE" && (r.metadata as { event: string }).event === "FUND_CLOSED" ? { ...r, actorUserId: "other" } : r);
  expect(codes(input)).toContain("AUDIT_CONFLICT"); expect(input.fund.closedByUserId).toBe("chief");
});
it("repeated corrections retain originals and a final void settles no household", () => {
  const input = fixture(); const base = input.payments!.rows[0];
  input.payments!.rows = ["p", "p2", "p3"].map((id) => ({ ...base, id, status: "VOIDED", voidReason: `Reason-${id}` }));
  input.receipts!.rows = input.payments!.rows.map((p) => ({ id: `r-${p.id}`, paymentId: p.id, villageId: "v", status: "VOIDED", receiptNumber: `N-${p.id}` }));
  input.audits!.rows = [...auditRows(input), ...[1, 2].map((i) => ({ id: `replacement-${i}`, fundId: "f", villageId: "v", entityType: "PAYMENT", entityId: input.payments!.rows[i].id, actionType: "CREATE", actorUserId: "collector", metadata: { event: "PAYMENT_REPLACED", paymentId: input.payments!.rows[i].id, previousPaymentId: input.payments!.rows[i - 1].id, houseId: "h", assessmentId: "a", amount: 1001, reason: input.payments!.rows[i - 1].voidReason } }))];
  expect(reconcileFund(input)).toMatchObject({ clean: true, metrics: { acceptedCollectionAmount: 0, outstandingHouseholdObligations: 1001 } });
});
it("missing void payment input does not invent an audit reason conflict", () => {
  const input = fixture(); input.payments!.rows = [{ ...input.payments!.rows[0], status: "VOIDED", voidReason: "Wrong payer" }]; input.receipts!.rows = [{ ...input.receipts!.rows[0], status: "VOIDED" }]; input.audits!.rows = auditRows(input);
  input.payments = { rows: [], complete: false };
  const result = reconcileFund(input); expect(result.clean).toBe(false); expect(result.findings.some((f) => f.code === "AUDIT_CONFLICT")).toBe(false);
});

it("rejects a DRAFT extension with otherwise-valid dates, versions and matching audit evidence", () => {
  const input = fixture("DRAFT");
  expect(reconcileFund(input)).toMatchObject({ clean: true, checks: { lifecycle: "NOT_APPLICABLE" } });
  input.fund.termsVersion = 2;
  input.extensions!.rows = [{ id: "e", fundId: "f", villageId: "v", previousEndDate: new Date("2026-10-31"), newEndDate: input.fund.endDate, previousTermsVersion: 1, newTermsVersion: 2, changedAt: date, changedByUserId: "chief", reason: "Extension" }];
  input.audits!.rows = [...input.audits!.rows, { id: "extension", fundId: "f", villageId: "v", entityType: "FUND_END_DATE_EXTENSION", entityId: "e", actionType: "UPDATE", actorUserId: "chief", metadata: { event: "FUND_EXTENDED", extensionId: "e", previousEndDate: "2026-10-31", newEndDate: "2026-11-30", termsVersion: 2, reason: "Extension" } }];
  const result = reconcileFund(input);
  expect(result).toMatchObject({ clean: false, checks: { lifecycle: "DISCREPANCY", audit: "DISCREPANCY" } });
  expect(result.findings).toEqual([
    expect.objectContaining({ category: "lifecycle", code: "DRAFT_EXTENSION", outcome: "DISCREPANCY" }),
    expect.objectContaining({ category: "audit", code: "AUDIT_VERSION", outcome: "DISCREPANCY" }),
  ]);
  expect(result.metrics?.outstandingHouseholdObligations).toBeNull();
});

it("rejects conflicting final draft/activation targets while preserving financial metrics", () => {
  const input = fixture(); const before = reconcileFund(input);
  expect(before.clean).toBe(true);
  input.audits!.rows = input.audits!.rows.map((row) => (row.metadata as { event: string }).event === "DRAFT_CREATED"
    ? { ...row, metadata: { event: "DRAFT_CREATED", termsVersion: 1, villageTargetAmount: 999 } } : row);
  const result = reconcileFund(input);
  expect(result.clean).toBe(false); expect(result.metrics).toEqual(before.metrics);
  expect(result.findings).toEqual([expect.objectContaining({ category: "audit", code: "AUDIT_CONFLICT", expected: "Final draft target=999", observed: "1001" })]);
});

it("accepts a legitimate target edit before activation", () => {
  const input = fixture(); input.fund.termsVersion = 3;
  input.audits!.rows = input.audits!.rows.map((row) => {
    const data = row.metadata as { event: string };
    if (data.event === "DRAFT_CREATED") return { ...row, metadata: { event: data.event, termsVersion: 1, villageTargetAmount: 999 } };
    if (data.event === "FUND_ACTIVATED") return { ...row, metadata: { ...row.metadata as object, termsVersion: 3 } };
    return row;
  });
  input.audits!.rows = [...input.audits!.rows, { ...input.audits!.rows[0], id: "edit", actionType: "UPDATE", metadata: { event: "DRAFT_UPDATED", termsVersion: 2, villageTargetAmount: 1001 } }];
  expect(reconcileFund(input)).toMatchObject({ clean: true, findings: [], metrics: { acceptedCollectionAmount: 1001 } });
});

it("does not infer a final target conflict from incomplete version evidence", () => {
  const input = fixture(); input.audits!.complete = false;
  input.audits!.rows = input.audits!.rows.map((row) => (row.metadata as { event: string }).event === "DRAFT_CREATED"
    ? { ...row, metadata: { event: "DRAFT_CREATED", termsVersion: 1, villageTargetAmount: 999 } } : row);
  const result = reconcileFund(input);
  expect(result).toMatchObject({ clean: false, checks: { audit: "UNVERIFIED" }, metrics: { acceptedCollectionAmount: 1001 } });
  expect(result.findings.some((finding) => finding.code === "AUDIT_CONFLICT")).toBe(false);
});

it("missing persisted collector attribution is unverified with independent financial metrics", () => {
  const input = fixture(); const before = reconcileFund(input);
  input.payments!.rows = [{ ...input.payments!.rows[0], collectorUserId: null }];
  const result = reconcileFund(input);
  expect(result).toMatchObject({ clean: false, checks: { audit: "UNVERIFIED" } });
  expect(result.metrics).toEqual(before.metrics);
  expect(result.findings).toEqual([expect.objectContaining({ category: "audit", code: "ACTOR_UNAVAILABLE", recordId: "p", outcome: "UNVERIFIED" })]);
});

it("compares payment and receipt creation actors even without a persisted collector", () => {
  const input = fixture(); input.payments!.rows = [{ ...input.payments!.rows[0], collectorUserId: null }];
  input.audits!.rows = input.audits!.rows.map((row) => (row.metadata as { event: string }).event === "RECEIPT_CREATED" ? { ...row, actorUserId: "other-collector" } : row);
  const result = reconcileFund(input);
  expect(result).toMatchObject({ clean: false, checks: { audit: "DISCREPANCY" }, metrics: { acceptedCollectionAmount: 1001 } });
  expect(result.findings).toEqual([
    expect.objectContaining({ code: "ACTOR_UNAVAILABLE", outcome: "UNVERIFIED", recordId: "p" }),
    expect.objectContaining({ code: "CREATION_ACTOR_CONFLICT", outcome: "DISCREPANCY", recordId: "p" }),
  ]);
});

// All original identities/receipts remain present. No timestamp/ID order is used.
function correctionFixture(): ReconciliationInput {
  const input = fixture(); const base = input.payments!.rows[0];
  input.payments!.rows = ["p", "p2", "p3"].map((id) => ({ ...base, id, status: "VOIDED", voidReason: `Reason-${id}` }));
  input.receipts!.rows = input.payments!.rows.map((p) => ({ id: `r-${p.id}`, paymentId: p.id, villageId: "v", status: "VOIDED", receiptNumber: `N-${p.id}` }));
  input.audits!.rows = [...auditRows(input), ...[1, 2].map((i) => ({ id: `replacement-${i}`, fundId: "f", villageId: "v", entityType: "PAYMENT", entityId: input.payments!.rows[i].id, actionType: "CREATE", actorUserId: "collector", metadata: { event: "PAYMENT_REPLACED", paymentId: input.payments!.rows[i].id, previousPaymentId: input.payments!.rows[i - 1].id, houseId: "h", assessmentId: "a", amount: 1001, reason: input.payments!.rows[i - 1].voidReason } }))];
  return input;
}

it.each([null, "collector"])("compares replacement creation actors with collector attribution %s", (collectorUserId) => {
  const input = correctionFixture(); expect(reconcileFund(input).clean).toBe(true);
  input.payments!.rows = input.payments!.rows.map((p) => p.id === "p2" ? { ...p, collectorUserId } : p);
  input.audits!.rows = input.audits!.rows.map((row) => row.id === "replacement-1" ? { ...row, actorUserId: "other-collector" } : row);
  const result = reconcileFund(input);
  expect(result).toMatchObject({ clean: false, checks: { audit: "DISCREPANCY" }, metrics: { acceptedCollectionAmount: 0, outstandingHouseholdObligations: 1001 } });
  expect(result.findings).toContainEqual(expect.objectContaining({ code: "CREATION_ACTOR_CONFLICT", recordId: "p2", outcome: "DISCREPANCY" }));
  if (collectorUserId === null) expect(result.findings).toContainEqual(expect.objectContaining({ code: "ACTOR_UNAVAILABLE", recordId: "p2", outcome: "UNVERIFIED" }));
});

it("accepts consistent historical creation actors without current membership or role inputs", () => {
  const input = correctionFixture();
  input.payments!.rows = input.payments!.rows.map((p) => ({ ...p, collectorUserId: "former-village-collector" }));
  input.audits!.rows = input.audits!.rows.map((row) => ["PAYMENT_CREATED", "RECEIPT_CREATED", "PAYMENT_REPLACED"].includes(String((row.metadata as { event: string }).event)) ? { ...row, actorUserId: "former-village-collector" } : row);
  expect(reconcileFund(input)).toMatchObject({ clean: true, findings: [], metrics: { acceptedCollectionAmount: 0 } });
});

it("detects a reused replacement predecessor with otherwise-consistent evidence", () => {
  const input = correctionFixture(); expect(reconcileFund(input).clean).toBe(true);
  input.audits!.rows = input.audits!.rows.map((row) => row.id === "replacement-2" ? { ...row, metadata: { ...row.metadata as object, previousPaymentId: "p", reason: "Reason-p" } } : row);
  const result = reconcileFund(input);
  expect(result.findings).toEqual([expect.objectContaining({ code: "REPLACEMENT_LINK", recordId: "p3", outcome: "DISCREPANCY" })]);
  expect(result.clean).toBe(false); expect(result.metrics?.acceptedCollectionAmount).toBe(0);
});

it("detects a multi-node replacement cycle without timestamp inference", () => {
  const input = correctionFixture(); expect(reconcileFund(input).clean).toBe(true);
  input.audits!.rows = [...input.audits!.rows, { id: "cycle", fundId: "f", villageId: "v", entityType: "PAYMENT", entityId: "p", actionType: "CREATE", actorUserId: "collector", metadata: { event: "PAYMENT_REPLACED", paymentId: "p", previousPaymentId: "p3", houseId: "h", assessmentId: "a", amount: 1001, reason: "Reason-p3" } }];
  const result = reconcileFund(input);
  expect(result.findings).toContainEqual(expect.objectContaining({ code: "REPLACEMENT_CYCLE", outcome: "DISCREPANCY" }));
  expect(result.findings).toContainEqual(expect.objectContaining({ code: "REPLACEMENT_ROOT", outcome: "DISCREPANCY" }));
  expect(result.clean).toBe(false); expect(result.metrics?.acceptedCollectionAmount).toBe(0);
});

it("requires an activation phase before extension versions in a complete non-DRAFT history", () => {
  const input = fixture("ACTIVE", false);
  input.extensions!.rows = [{ id: "e", fundId: "f", villageId: "v", previousEndDate: new Date("2026-10-31"), newEndDate: input.fund.endDate, previousTermsVersion: 1, newTermsVersion: 2, changedAt: date, changedByUserId: "chief", reason: "Extension" }];
  input.audits!.rows = [input.audits!.rows[0], { id: "extension", fundId: "f", villageId: "v", entityType: "FUND_END_DATE_EXTENSION", entityId: "e", actionType: "UPDATE", actorUserId: "chief", metadata: { event: "FUND_EXTENDED", extensionId: "e", previousEndDate: "2026-10-31", newEndDate: "2026-11-30", termsVersion: 2, reason: "Extension" } }];
  const result = reconcileFund(input);
  // Require phase validation itself, not just the missing-event guard.
  expect(result.findings).toContainEqual(expect.objectContaining({ category: "audit", code: "AUDIT_VERSION", outcome: "DISCREPANCY" }));
  expect(result.findings.some((finding) => finding.code === "EXTENSION_INVALID" || finding.code === "EXTENSION_CHAIN")).toBe(false);
  expect(result.clean).toBe(false); expect(result.metrics).not.toBeNull();
});
