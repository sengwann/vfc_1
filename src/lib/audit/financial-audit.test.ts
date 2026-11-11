import { AuditActionType } from "@prisma/client";
import { AuditEntityType } from "./audit.types";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createFinancialAudit, type FinancialAuditInput } from "./financial-audit";
import { createAuditLog } from "./audit.service";
import type { FinancialTransactionClient } from "../db/village-scope";

const base = { actorUserId: "actor", fundId: "fund", villageId: "village" };
const payment = { paymentId: "payment", houseId: "house", assessmentId: "assessment", amount: 1001 };
const cases: FinancialAuditInput[] = [
  { ...base, event: "DRAFT_CREATED", metadata: { villageTargetAmount: 1001, termsVersion: 1 } },
  { ...base, event: "DRAFT_UPDATED", metadata: { villageTargetAmount: 1002, termsVersion: 2 } },
  { ...base, event: "FUND_ACTIVATED", metadata: { villageTargetAmount: 1001, termsVersion: 2, eligibleHouseCount: 1, assessmentPerHouse: 1001, totalAssessment: 1001, roundingSurplus: 0, snapshotAt: "2026-01-01T00:00:00Z" } },
  { ...base, event: "PAYMENT_CREATED", metadata: payment },
  { ...base, event: "RECEIPT_CREATED", metadata: { paymentId: "payment", receiptId: "receipt", receiptNumber: "R1" } },
  { ...base, event: "PAYMENT_VOIDED", metadata: { ...payment, reason: "Correction" } },
  { ...base, event: "RECEIPT_VOIDED", metadata: { paymentId: "payment", receiptId: "receipt", reason: "Correction" } },
  { ...base, event: "PAYMENT_REPLACED", metadata: { ...payment, previousPaymentId: "old", reason: "Correction" } },
  { ...base, event: "FUND_EXTENDED", metadata: { extensionId: "extension", previousEndDate: "2026-01-01", newEndDate: "2026-01-02", reason: "Unpaid houses", termsVersion: 3 } },
  { ...base, event: "FUND_CLOSED", metadata: { closedAt: "2026-01-02T00:00:00Z", termsVersion: 4, acceptedPaymentCount: 1 } },
];
const expectedEvents = {
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
describe("financial audit", () => {
  it.each(cases)("links $event to the Fund, Village, actor and appropriate entity", async (input) => {
    const create = vi.fn().mockResolvedValue({ id: "audit" });
    const tx = { auditLog: { create } } as unknown as FinancialTransactionClient;
    await createFinancialAudit(tx, input);
    const expectedEntity = input.event.startsWith("RECEIPT") ? "receipt"
      : input.event.startsWith("PAYMENT") ? "payment"
      : input.event === "FUND_EXTENDED" ? "extension" : "fund";
    const [actionType, entityType] = expectedEvents[input.event];
    expect(create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({
      actionType, entityType, ...base, entityId: expectedEntity, metadata: { ...input.metadata, event: input.event },
    }) });
  });
  it.each(["actorUserId", "fundId", "villageId", "event", "metadata"])("rejects missing %s before insertion", async (key) => {
    const create = vi.fn();
    const input = { ...cases[0], [key]: undefined } as unknown as FinancialAuditInput;
    await expect(createFinancialAudit({ auditLog: { create } } as unknown as FinancialTransactionClient, input)).rejects.toBeInstanceOf(TypeError);
    expect(create).not.toHaveBeenCalled();
  });
  it("requires event-specific metadata both statically and at runtime", async () => {
    expectTypeOf<{ event: "PAYMENT_CREATED"; metadata: { amount: number } }>().not.toMatchTypeOf<FinancialAuditInput>();
    const create = vi.fn();
    await expect(createFinancialAudit({ auditLog: { create } } as unknown as FinancialTransactionClient,
      { ...base, event: "PAYMENT_CREATED", metadata: { amount: 1 } } as FinancialAuditInput)).rejects.toThrow("VFC_AUDIT_REQUIRED_FIELD");
    expect(create).not.toHaveBeenCalled();
  });
  it("propagates insertion failure unchanged", async () => {
    const failure = Object.assign(new Error("audit unavailable"), { code: "23503" });
    const create = vi.fn().mockRejectedValue(failure);
    await expect(createFinancialAudit({ auditLog: { create } } as unknown as FinancialTransactionClient, cases[0])).rejects.toBe(failure);
  });
  it("keeps unrelated generic audits scope-free and fundId optional", async () => {
    const query = vi.fn(); const create = vi.fn().mockResolvedValue({ id: "audit" });
    await createAuditLog({ $queryRaw: query, auditLog: { create } } as unknown as FinancialTransactionClient,
      { actionType: "LOGIN", entityType: "SESSION" });
    expect(query).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({ fundId: null, villageId: null }) });
  });
});
