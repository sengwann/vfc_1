import "server-only";

import type { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireVillager } from "@/lib/authz/roles";
import { redirectForbidden } from "@/lib/authz/authz.errors";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import { CHANGE_PASSWORD_ROUTE, LOGIN_ROUTE } from "@/lib/auth/auth.constants";
import { FundReportIntegrityError } from "./fund-report-queries";
import { calculateFundAssessment, validatePaymentAmount } from "./fund-financials";
import type { HouseholdFundStatus } from "./household-reporting-types";

/** No caller-supplied identity, village, household or fund. Returns only self coverage. */
export async function getMemberCurrentFund() {
  const context = await requireVillager();
  const identity = await getSessionIdentity();
  if (!identity || identity.userId !== context.user.id) redirect(LOGIN_ROUTE);
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const actor = await tx.user.findUnique({
      where: { id: identity.userId },
      select: {
        sessionVersion: true, mustChangePassword: true, role: true,
        membershipStatus: true, villageId: true, houseId: true,
        village: { select: { status: true } },
      },
    });
    if (!actor || actor.sessionVersion !== identity.sessionVersion) redirect(LOGIN_ROUTE);
    if (actor.mustChangePassword) redirect(CHANGE_PASSWORD_ROUTE);
    if (actor.role !== "VILLAGER" || actor.membershipStatus !== "ACTIVE" ||
        actor.villageId !== context.villageId || actor.village?.status !== "ACTIVE") redirectForbidden();
    const villageId = context.villageId;
    const fund = await tx.fund.findFirst({
      where: { villageId, status: "ACTIVE" },
      select: {
        id: true, name: true, villageTargetAmount: true, startDate: true, endDate: true,
        eligibleHouseCount: true, assessmentPerHouse: true, snapshotAt: true,
      },
    });
    if (!fund) return null;
    const calculation = calculateFundAssessment({
      villageTargetAmount: fund.villageTargetAmount,
      eligibleHouseCount: fund.eligibleHouseCount ?? 0,
    });
    if (!calculation.ok || fund.assessmentPerHouse !== calculation.data.assessmentPerHouse ||
        !(fund.snapshotAt instanceof Date) || !Number.isFinite(fund.snapshotAt.getTime())) {
      throw new FundReportIntegrityError();
    }
    const displayFund = {
      id: fund.id, name: fund.name, villageTargetAmount: fund.villageTargetAmount,
      startDate: fund.startDate, endDate: fund.endDate,
    };
    let household: HouseholdFundStatus;
    if (!actor.houseId) {
      household = { state: "NO_HOUSEHOLD", assessmentAmount: null, outstandingAmount: null };
    } else {
      const house = await tx.house.findFirst({ where: { id: actor.houseId, villageId }, select: { id: true } });
      if (!house) throw new FundReportIntegrityError();
      const assessment = await tx.fundHouseAssessment.findFirst({
        where: { fundId: fund.id, villageId, houseId: actor.houseId },
        select: {
          id: true, assessmentAmount: true,
          payments: {
            where: { fundId: fund.id, villageId, houseId: actor.houseId, status: "ACCEPTED" },
            select: { id: true, amount: true },
          },
        },
      });
      if (!assessment) {
        household = { state: "NOT_ASSESSED", assessmentAmount: null, outstandingAmount: null };
      } else {
        if (assessment.assessmentAmount !== fund.assessmentPerHouse || assessment.payments.length > 1 ||
            assessment.payments.some((payment) => !validatePaymentAmount({
              paymentAmount: payment.amount, assessmentAmount: assessment.assessmentAmount,
            }).ok)) throw new FundReportIntegrityError();
        const paid = assessment.payments.length === 1;
        household = {
          state: paid ? "PAID" : "UNPAID", assessmentAmount: assessment.assessmentAmount,
          outstandingAmount: paid ? 0 : assessment.assessmentAmount,
        };
      }
    }
    return { fund: displayFund, household };
  }, { isolationLevel: "RepeatableRead", maxWait: 2_000, timeout: 5_000 });
}
