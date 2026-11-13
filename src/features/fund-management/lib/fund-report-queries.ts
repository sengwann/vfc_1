import "server-only";

import type { Prisma } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireChief } from "@/lib/authz/roles";
import { redirectForbidden } from "@/lib/authz/authz.errors";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import { LOGIN_ROUTE, CHANGE_PASSWORD_ROUTE } from "@/lib/auth/auth.constants";
import { calculateFundAssessment } from "./fund-financials";
import {
  calculateFundReportingMetrics,
  type ReportingAssessment,
} from "./fund-reporting";

export class FundReportIntegrityError extends Error {
  constructor() {
    super("Fund reporting snapshot is inconsistent.");
    this.name = "FundReportIntegrityError";
  }
}

function requireIntegrity(condition: boolean): asserts condition {
  if (!condition) throw new FundReportIntegrityError();
}

interface LinkedAssessment {
  id: string;
  houseId: string;
  assessmentAmount: number;
  payments: ReportingAssessment["payments"][number][];
}

/**
 * Chief-only reader, matching the existing Fund list/detail permissions.
 * No client-supplied tenant, rows, counts or totals are accepted. Each call
 * authenticates anew; do not wrap this function in a shared cross-request cache.
 * Page controls affect only returned display rows, never metric inputs.
 */
export async function getChiefFundReport(
  fundId: string,
  options: { page?: number; pageSize?: number } = {},
) {
  const context = await requireChief();
  const identity = await getSessionIdentity();
  if (!identity || identity.userId !== context.user.id) redirect(LOGIN_ROUTE);
  if (typeof fundId !== "string" || !fundId.trim() || fundId.includes("\0"))
    notFound();
  const page = options.page ?? 1;
  const pageSize = options.pageSize ?? 25;
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100 ||
    !Number.isSafeInteger((page - 1) * pageSize)
  ) {
    throw new RangeError("Invalid fund report pagination.");
  }

  return prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      // First statement, before any data read. No financial scope acquisition,
      // row/advisory write locks, revision bumps or transaction retries are needed.
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const actor = await tx.user.findUnique({
        where: { id: identity.userId },
        select: {
          sessionVersion: true,
          mustChangePassword: true,
          role: true,
          membershipStatus: true,
          villageId: true,
          village: { select: { status: true } },
        },
      });
      if (!actor || actor.sessionVersion !== identity.sessionVersion)
        redirect(LOGIN_ROUTE);
      if (actor.mustChangePassword) redirect(CHANGE_PASSWORD_ROUTE);
      if (
        actor.role !== "CHIEF" ||
        actor.membershipStatus !== "ACTIVE" ||
        actor.villageId !== context.villageId ||
        actor.village?.status !== "ACTIVE"
      )
        redirectForbidden();
      const villageId = context.villageId;
      const fund = await tx.fund.findFirst({
        where: { id: fundId, villageId },
        select: {
          id: true,
          villageId: true,
          name: true,
          status: true,
          villageTargetAmount: true,
          eligibleHouseCount: true,
          assessmentPerHouse: true,
          snapshotAt: true,
          termsVersion: true,
        },
      });
      if (!fund) notFound(); // Same response for missing and foreign-village funds.
      requireIntegrity(fund.id === fundId && fund.villageId === villageId);
      const assessments = await tx.fundHouseAssessment.findMany({
        where: { fundId, villageId },
        orderBy: [{ houseNumberSnapshot: "asc" }, { id: "asc" }],
        select: {
          id: true,
          fundId: true,
          villageId: true,
          houseId: true,
          houseNumberSnapshot: true,
          assessmentAmount: true,
        },
      });
      // Fetch independently by fund, not via an assessment-ID filter: an orphan
      // or wrongly linked payment must fail validation rather than disappear.
      const payments = await tx.payment.findMany({
        where: { fundId, villageId },
        select: {
          id: true,
          fundId: true,
          villageId: true,
          houseId: true,
          fundHouseAssessmentId: true,
          amount: true,
          status: true,
        },
      });
      requireIntegrity(
        Number.isSafeInteger(fund.termsVersion) && fund.termsVersion > 0,
      );
      if (fund.status === "DRAFT") {
        requireIntegrity(
          fund.eligibleHouseCount === null &&
            fund.assessmentPerHouse === null &&
            fund.snapshotAt === null &&
            assessments.length === 0 &&
            payments.length === 0,
        );
      } else {
        requireIntegrity(fund.status === "ACTIVE" || fund.status === "CLOSED");
        requireIntegrity(
          fund.eligibleHouseCount !== null &&
            fund.eligibleHouseCount === assessments.length &&
            fund.snapshotAt instanceof Date &&
            Number.isFinite(fund.snapshotAt.getTime()),
        );
        const calculation = calculateFundAssessment({
          villageTargetAmount: fund.villageTargetAmount,
          eligibleHouseCount: assessments.length,
        });
        requireIntegrity(
          calculation.ok &&
            fund.assessmentPerHouse === calculation.data.assessmentPerHouse,
        );
      }
      const byId = new Map<string, LinkedAssessment>();
      const houses = new Set<string>();
      for (const row of assessments) {
        requireIntegrity(
          Boolean(row.id.trim()) &&
            !byId.has(row.id) &&
            !houses.has(row.houseId) &&
            Boolean(row.houseId.trim()) &&
            row.fundId === fundId &&
            row.villageId === villageId &&
            Boolean(row.houseNumberSnapshot.trim()) &&
            row.assessmentAmount === fund.assessmentPerHouse,
        );
        houses.add(row.houseId);
        byId.set(row.id, {
          id: row.id,
          houseId: row.houseId,
          assessmentAmount: row.assessmentAmount,
          payments: [],
        });
      }
      const paymentIds = new Set<string>();
      for (const payment of payments) {
        const assessment = byId.get(payment.fundHouseAssessmentId);
        requireIntegrity(
          Boolean(payment.id.trim()) &&
            !paymentIds.has(payment.id) &&
            payment.fundId === fundId &&
            payment.villageId === villageId &&
            assessment !== undefined &&
            payment.houseId === assessment.houseId,
        );
        paymentIds.add(payment.id);
        // Explicit runtime check also protects mocked/incorrect adapter data.
        requireIntegrity(
          payment.status === "ACCEPTED" || payment.status === "VOIDED",
        );
        requireIntegrity(assessment !== undefined);
        assessment.payments.push({
          status: payment.status,
          amount: payment.amount,
        });
      }
      const result = calculateFundReportingMetrics({
        status: fund.status,
        villageTargetAmount: fund.villageTargetAmount,
        assessments: [...byId.values()],
      });
      if (!result.ok) throw new FundReportIntegrityError();
      requireIntegrity(fund.status !== "CLOSED" || result.data.isComplete);
      const offset = (page - 1) * pageSize;
      return {
        fund,
        metrics: result.data,
        assessmentPage: {
          page,
          pageSize,
          total: assessments.length,
          totalPages: Math.max(1, Math.ceil(assessments.length / pageSize)),
          rows: assessments.slice(offset, offset + pageSize).map((row) => {
            const accepted = byId
              .get(row.id)!
              .payments.find((payment) => payment.status === "ACCEPTED");
            return {
              id: row.id,
              houseId: row.houseId,
              houseNumberSnapshot: row.houseNumberSnapshot,
              assessmentAmount: row.assessmentAmount,
              paid: accepted !== undefined,
              acceptedCollectionAmount: accepted?.amount ?? 0,
            };
          }),
        },
      };
    },
    { isolationLevel: "RepeatableRead", maxWait: 2_000, timeout: 5_000 },
  );
}
