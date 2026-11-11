import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withSerializableRetry } from "@/lib/db/transaction";
import { authorizeFinancialTransaction } from "@/lib/authz/transaction-authority";
import { createFinancialAudit } from "@/lib/audit/financial-audit";
import { FundWriteError } from "./fund-write";

type Submitted = { id: string; termsVersion: number };
async function currentFund(tx: Prisma.TransactionClient, villageId: string, submitted: Submitted) {
  const authority = await authorizeFinancialTransaction(tx, { villageId, permission: "chief", fundIds: [submitted.id] });
  const fund = await tx.fund.findFirstOrThrow({ where: { id: submitted.id, villageId } });
  if (fund.status !== "ACTIVE") throw new FundWriteError("Only active funds can be extended or closed.");
  if (fund.termsVersion !== submitted.termsVersion) throw new FundWriteError("Fund details have changed. Reload the form.");
  const unpaid = await tx.fundHouseAssessment.count({ where: { fundId: fund.id, villageId, payments: { none: { status: "ACCEPTED" } } } });
  return { fund, unpaid, actorUserId: authority.actor.id };
}

export async function extendFund(villageId: string, submitted: Submitted, input: { newEndDate: Date; reason: string }) {
  if (!Number.isFinite(input.newEndDate.getTime()) || !input.reason.trim() || input.reason.includes("\0")) throw new FundWriteError("Extension date and reason are required.");
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const { fund, unpaid, actorUserId } = await currentFund(tx, villageId, submitted);
    const [clock] = await tx.$queryRaw<{ expired: boolean; now: Date }[]>`
      SELECT public.vfc_fund_expired("endDate",clock_timestamp()) AS expired, clock_timestamp() AS now
      FROM public."Fund" WHERE id=${fund.id} AND "villageId"=${villageId}`;
    if (!clock?.expired) throw new FundWriteError("Only expired funds can be extended.");
    if (unpaid === 0) throw new FundWriteError("Only funds with unpaid assessments can be extended.");
    if (input.newEndDate.toISOString().slice(0, 10) <= fund.endDate.toISOString().slice(0, 10)) throw new FundWriteError("New end date must be later than the previous end date.");
    const extension = await tx.fundEndDateExtension.create({ data: { fundId: fund.id, villageId,
      previousEndDate: fund.endDate, newEndDate: input.newEndDate,
      previousTermsVersion: fund.termsVersion, newTermsVersion: fund.termsVersion + 1,
      changedByUserId: actorUserId, changedAt: clock.now, reason: input.reason.trim() } });
    const updated = await tx.fund.update({ where: { id: fund.id }, data: { endDate: input.newEndDate, termsVersion: { increment: 1 } } });
    await createFinancialAudit(tx, { villageId, fundId: fund.id, actorUserId, event: "FUND_EXTENDED",
      metadata: { extensionId: extension.id, previousEndDate: fund.endDate.toISOString().slice(0, 10), newEndDate: input.newEndDate.toISOString().slice(0, 10), reason: extension.reason, termsVersion: updated.termsVersion } });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function closeFund(villageId: string, submitted: Submitted) {
  return withSerializableRetry(() => prisma.$transaction(async (tx) => {
    const { fund, unpaid, actorUserId } = await currentFund(tx, villageId, submitted);
    if (unpaid !== 0) throw new FundWriteError("Every assessed house must have an accepted payment before closure.");
    // Coverage, not expiry or aggregate money, determines completion.
    const acceptedPaymentCount = await tx.payment.count({ where: { fundId: fund.id, villageId, status: "ACCEPTED" } });
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const updated = await tx.fund.update({ where: { id: fund.id }, data: { status: "CLOSED", closedAt: now, closedByUserId: actorUserId, termsVersion: { increment: 1 } } });
    await createFinancialAudit(tx, { villageId, fundId: fund.id, actorUserId, event: "FUND_CLOSED",
      metadata: { closedAt: now.toISOString(), termsVersion: updated.termsVersion, acceptedPaymentCount } });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}
