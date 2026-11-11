import "server-only";
import { AuditActionType } from "@prisma/client";
import { assertTransactionClient, type FinancialTransactionClient } from "../db/village-scope";
import { createAuditLog } from "./audit.service";
import { AuditEntityType } from "./audit.types";

type FundTerms = { villageTargetAmount: number; termsVersion: number };
type PaymentIdentity = { paymentId: string; houseId: string; assessmentId: string; amount: number };
type Events = {
  DRAFT_CREATED: FundTerms;
  DRAFT_UPDATED: FundTerms;
  FUND_ACTIVATED: FundTerms & { eligibleHouseCount: number; assessmentPerHouse: number; totalAssessment: number; roundingSurplus: number; snapshotAt: string };
  PAYMENT_CREATED: PaymentIdentity;
  RECEIPT_CREATED: { paymentId: string; receiptId: string; receiptNumber: string };
  PAYMENT_VOIDED: PaymentIdentity & { reason: string };
  RECEIPT_VOIDED: { paymentId: string; receiptId: string; reason: string };
  PAYMENT_REPLACED: PaymentIdentity & { previousPaymentId: string; reason: string };
  FUND_EXTENDED: { extensionId: string; previousEndDate: string; newEndDate: string; reason: string; termsVersion: number };
  FUND_CLOSED: { closedAt: string; termsVersion: number; acceptedPaymentCount: number };
};
export type FinancialAuditEvent = keyof Events;
export type FinancialAuditInput = {
  [E in FinancialAuditEvent]: {
    actorUserId: string;
    fundId: string;
    villageId: string;
    event: E;
    metadata: Events[E];
  }
}[FinancialAuditEvent];

const definitions = {
  DRAFT_CREATED: [AuditActionType.CREATE, AuditEntityType.FUND],
  DRAFT_UPDATED: [AuditActionType.UPDATE, AuditEntityType.FUND],
  FUND_ACTIVATED: [AuditActionType.STATUS_CHANGE, AuditEntityType.FUND],
  PAYMENT_CREATED: [AuditActionType.CREATE, AuditEntityType.PAYMENT],
  RECEIPT_CREATED: [AuditActionType.CREATE, AuditEntityType.RECEIPT],
  PAYMENT_VOIDED: [AuditActionType.VOID, AuditEntityType.PAYMENT],
  RECEIPT_VOIDED: [AuditActionType.VOID, AuditEntityType.RECEIPT],
  PAYMENT_REPLACED: [AuditActionType.CREATE, AuditEntityType.PAYMENT],
  FUND_EXTENDED: [AuditActionType.UPDATE, AuditEntityType.FUND_END_DATE_EXTENSION],
  FUND_CLOSED: [AuditActionType.STATUS_CHANGE, AuditEntityType.FUND],
} as const;
const fields: { [E in FinancialAuditEvent]: readonly (keyof Events[E])[] } = {
  DRAFT_CREATED: ["villageTargetAmount", "termsVersion"],
  DRAFT_UPDATED: ["villageTargetAmount", "termsVersion"],
  FUND_ACTIVATED: ["villageTargetAmount", "termsVersion", "eligibleHouseCount", "assessmentPerHouse", "totalAssessment", "roundingSurplus", "snapshotAt"],
  PAYMENT_CREATED: ["paymentId", "houseId", "assessmentId", "amount"],
  RECEIPT_CREATED: ["paymentId", "receiptId", "receiptNumber"],
  PAYMENT_VOIDED: ["paymentId", "houseId", "assessmentId", "amount", "reason"],
  RECEIPT_VOIDED: ["paymentId", "receiptId", "reason"],
  PAYMENT_REPLACED: ["paymentId", "houseId", "assessmentId", "amount", "previousPaymentId", "reason"],
  FUND_EXTENDED: ["extensionId", "previousEndDate", "newEndDate", "reason", "termsVersion"],
  FUND_CLOSED: ["closedAt", "termsVersion", "acceptedPaymentCount"],
};
const numeric = new Set(["villageTargetAmount", "termsVersion", "eligibleHouseCount", "assessmentPerHouse", "totalAssessment", "roundingSurplus", "amount", "acceptedPaymentCount"]);
function requiredId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) throw new TypeError("VFC_AUDIT_REQUIRED_FIELD");
}

/** Must be awaited inside the associated write transaction. Never best-effort. */
export async function createFinancialAudit(tx: FinancialTransactionClient, input: FinancialAuditInput) {
  assertTransactionClient(tx);
  requiredId(input.actorUserId); requiredId(input.fundId); requiredId(input.villageId);
  if (!Object.prototype.hasOwnProperty.call(definitions, input.event)) throw new TypeError("VFC_AUDIT_EVENT");
  if (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata)) throw new TypeError("VFC_AUDIT_REQUIRED_FIELD");
  const metadata: Record<string, string | number> = { event: input.event };
  // Whitelist fields so arbitrary secrets or caller-supplied event labels cannot
  // override the canonical audit event. Monetary values must serialize safely.
  for (const key of fields[input.event]) {
    const value: unknown = (input.metadata as unknown as Record<string, unknown>)[key];
    if (numeric.has(key)) {
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (key === "roundingSurplus" ? 0 : 1)) throw new TypeError("VFC_AUDIT_REQUIRED_FIELD");
      metadata[key] = value;
    } else { requiredId(value); metadata[key] = value; }
  }
  const [actionType, entityType] = definitions[input.event];
  const entityId = entityType === AuditEntityType.PAYMENT ? metadata.paymentId
    : entityType === AuditEntityType.RECEIPT ? metadata.receiptId
    : entityType === AuditEntityType.FUND_END_DATE_EXTENSION ? metadata.extensionId : input.fundId;
  // The Phase 2 audit trigger verifies Fund/Village/entity consistency. Do not
  // catch failures here: rejection must abort the enclosing financial operation.
  return createAuditLog(tx, {
    actorUserId: input.actorUserId, fundId: input.fundId, villageId: input.villageId,
    entityId: String(entityId), actionType, entityType, metadata,
  });
}
