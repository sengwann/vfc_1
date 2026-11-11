import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/db/transaction";
import { acquireVillageScopes } from "@/lib/db/village-scope";
import { authorizeFinancialTransaction } from "@/lib/authz/transaction-authority";
import { createFinancialAudit } from "@/lib/audit/financial-audit";
import { calculateFundAssessment, validateVillageTargetAmount } from "./fund-financials";

export class FundWriteError extends Error {}
export interface DraftTerms {
  name: string;
  description: string | null;
  villageTargetAmount: number;
  startDate: Date;
  endDate: Date;
}
export function submittedFund(form: FormData) {
  const id = form.get("fundId"), version = form.get("termsVersion");
  if (typeof id !== "string" || !id.trim() || id.includes("\0") ||
      typeof version !== "string" || !/^[1-9]\d*$/.test(version) ||
      !Number.isSafeInteger(Number(version)) || Number(version) >= 2147483647) {
    throw new FundWriteError("Fund details have changed. Reload the form.");
  }
  return { id, termsVersion: Number(version) };
}
function checkedTarget(terms: DraftTerms) {
  const target = validateVillageTargetAmount(terms.villageTargetAmount);
  if (!target.ok) throw new FundWriteError(target.error);
}
export async function createFundDraft(villageId: string, terms: DraftTerms) {
  checkedTarget(terms);
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const authority = await authorizeFinancialTransaction(tx, { villageId, permission: "chief" });
    // Eligibility and assessments are deliberately absent until activation.
    const fund = await tx.fund.create({ data: { ...terms, villageId, status: "DRAFT" } });
    await createFinancialAudit(tx, { villageId, fundId: fund.id, actorUserId: authority.actor.id,
      event: "DRAFT_CREATED", metadata: { villageTargetAmount: fund.villageTargetAmount, termsVersion: fund.termsVersion } });
    return fund;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
export async function updateFundDraft(villageId: string, submitted: { id: string; termsVersion: number }, terms: DraftTerms) {
  checkedTarget(terms);
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const authority = await authorizeFinancialTransaction(tx, { villageId, permission: "chief", fundIds: [submitted.id] });
    const current = authority.funds[0];
    if (current.status !== "DRAFT") throw new FundWriteError("Only draft funds can be edited.");
    if (current.termsVersion !== submitted.termsVersion) throw new FundWriteError("Fund details have changed. Reload the form.");
    const fund = await tx.fund.update({ where: { id: current.id }, data: { ...terms, termsVersion: { increment: 1 } } });
    await createFinancialAudit(tx, { villageId, fundId: fund.id, actorUserId: authority.actor.id,
      event: "DRAFT_UPDATED", metadata: { villageTargetAmount: fund.villageTargetAmount, termsVersion: fund.termsVersion } });
    return fund;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
export async function activateFund(villageId: string, submitted: { id: string; termsVersion: number }) {
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    await acquireVillageScopes(tx, [villageId]);
    // Discovery after scope acquisition, before ANY entity locks. Pass the
    // complete Fund/House set to authority so its actor lock remains last.
    const active = await tx.fund.findMany({ where: { villageId, status: "ACTIVE" }, select: { id: true } });
    const eligible = await tx.house.findMany({ where: { villageId, isActive: true,
      members: { some: { villageId, membershipStatus: "ACTIVE" } } },
      orderBy: { id: "asc" }, select: { id: true } });
    const authority = await authorizeFinancialTransaction(tx, { villageId, permission: "chief",
      fundIds: [submitted.id, ...active.map((f) => f.id)], houseIds: eligible.map((h) => h.id) });
    const current = authority.funds.find((f) => f.id === submitted.id);
    if (!current) throw new FundWriteError("Fund not found.");
    if (current.status !== "DRAFT") throw new FundWriteError("Only draft funds can be activated.");
    if (current.termsVersion !== submitted.termsVersion) throw new FundWriteError("Fund details have changed. Reload the form.");
    if (active.length) throw new FundWriteError("An active fund already exists for this village.");
    const fund = await tx.fund.findFirstOrThrow({ where: { id: current.id, villageId } });
    // Re-read eligibility and display identity under scope + ordered House locks.
    const houses = await tx.house.findMany({ where: { villageId, isActive: true,
      members: { some: { villageId, membershipStatus: "ACTIVE" } } },
      orderBy: { id: "asc" }, select: { id: true, houseNumber: true } });
    if (houses.length !== eligible.length || houses.some((h, i) => h.id !== eligible[i].id)) {
      throw new FundWriteError("House eligibility changed. Reload the form.");
    }
    const calculation = calculateFundAssessment({ villageTargetAmount: fund.villageTargetAmount, eligibleHouseCount: houses.length });
    if (!calculation.ok) throw new FundWriteError(calculation.error);
    const values = calculation.data;
    // PostgreSQL permits snapshot inserts only while the parent is DRAFT.
    await tx.fundHouseAssessment.createMany({ data: houses.map((h) => ({ fundId: fund.id,
      villageId, houseId: h.id, houseNumberSnapshot: h.houseNumber, assessmentAmount: values.assessmentPerHouse })) });
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const activated = await tx.fund.update({ where: { id: fund.id }, data: { status: "ACTIVE",
      eligibleHouseCount: values.eligibleHouseCount, assessmentPerHouse: values.assessmentPerHouse,
      snapshotAt: now, termsVersion: { increment: 1 } } });
    await createFinancialAudit(tx, { villageId, fundId: fund.id, actorUserId: authority.actor.id,
      event: "FUND_ACTIVATED", metadata: { villageTargetAmount: values.villageTargetAmount,
        termsVersion: activated.termsVersion, eligibleHouseCount: values.eligibleHouseCount,
        assessmentPerHouse: values.assessmentPerHouse, totalAssessment: values.totalAssessments,
        roundingSurplus: values.roundingSurplus, snapshotAt: now.toISOString() } });
    return activated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
