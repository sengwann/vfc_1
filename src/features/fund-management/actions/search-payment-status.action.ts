"use server";

import { MembershipStatus, UserRole, type Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { getCurrentUser, getSessionIdentity } from "../../../lib/auth/session";
import { getActiveCollectorContext, getCurrentPeriod } from "../../../lib/authz";
import { FundReportIntegrityError } from "../lib/fund-report-queries";
import type { AssessedHouseStatus } from "../lib/household-reporting-types";

export interface PaymentStatusSearchItem {
  id: string;
  houseNumber: string;
  headName: string | null;
  status: AssessedHouseStatus;
}

export type PaymentStatusSearchErrorCode = "SIGNED_OUT" | "PASSWORD_CHANGE" | "VILLAGE_NOT_FOUND" | "FORBIDDEN" | "FUND_NOT_FOUND";
export type PaymentStatusSearchActionResult =
  | { ok: true; results: PaymentStatusSearchItem[] }
  | { ok: false; code: PaymentStatusSearchErrorCode };

function getFormDataString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function searchPaymentStatusAction(formData: FormData): Promise<PaymentStatusSearchActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "SIGNED_OUT" };
  if (user.mustChangePassword) return { ok: false, code: "PASSWORD_CHANGE" };
  if (user.role === UserRole.SYSTEM_ADMIN || !user.villageId) return { ok: false, code: "VILLAGE_NOT_FOUND" };
  const villageId = user.villageId;
  const isChiefUser = user.role === UserRole.CHIEF && user.membershipStatus === MembershipStatus.ACTIVE;
  const collectorContext = await getActiveCollectorContext(user);
  if (!isChiefUser && !collectorContext) return { ok: false, code: "FORBIDDEN" };
  const identity = await getSessionIdentity();
  if (!identity || identity.userId !== user.id) return { ok: false, code: "SIGNED_OUT" };
  const query = getFormDataString(formData, "q").trim();
  const fundId = getFormDataString(formData, "fundId");

  return prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<PaymentStatusSearchActionResult> => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const actor = await tx.user.findUnique({
      where: { id: identity.userId },
      select: {
        sessionVersion: true, mustChangePassword: true, villageId: true,
        role: true, membershipStatus: true, village: { select: { status: true } },
      },
    });
    if (!actor || actor.sessionVersion !== identity.sessionVersion) return { ok: false, code: "SIGNED_OUT" };
    if (actor.mustChangePassword) return { ok: false, code: "PASSWORD_CHANGE" };
    if (actor.villageId !== villageId || actor.village?.status !== "ACTIVE" || actor.membershipStatus !== "ACTIVE" || actor.role === "SYSTEM_ADMIN") {
      return { ok: false, code: "FORBIDDEN" };
    }
    if (actor.role !== "CHIEF") {
      const period = getCurrentPeriod();
      const assignment = await tx.collectorAssignment.findFirst({
        where: { userId: user.id, villageId, isActive: true, year: period.year, month: period.month },
        select: { id: true },
      });
      if (!assignment) return { ok: false, code: "FORBIDDEN" };
    }
    if (!query) return { ok: true, results: [] };
    const fund = await tx.fund.findFirst({ where: { id: fundId, villageId }, select: { id: true, status: true } });
    if (!fund) return { ok: false, code: "FUND_NOT_FOUND" };
    // Live house labels support the existing search. Coverage comes exclusively
    // from this fund's frozen assessment and its related accepted payment.
    const houses = await tx.house.findMany({
      where: {
        villageId,
        OR: [{ houseNumber: { contains: query, mode: "insensitive" } },
          { headOfHouse: { name: { contains: query, mode: "insensitive" } } }],
      },
      orderBy: { houseNumber: "asc" },
      select: {
        id: true, houseNumber: true, headOfHouse: { select: { name: true } },
        assessments: {
          where: { fundId: fund.id, villageId },
          select: {
            id: true,
            payments: {
              where: { fundId: fund.id, villageId, status: "ACCEPTED" },
              select: { id: true },
            },
          },
        },
      },
    });
    const results: PaymentStatusSearchItem[] = houses.map((house) => {
      const assessment = house.assessments[0];
      if (house.assessments.length > 1 || (assessment?.payments.length ?? 0) > 1 ||
          (fund.status === "DRAFT" && assessment)) throw new FundReportIntegrityError();
      return {
        id: house.id, houseNumber: house.houseNumber, headName: house.headOfHouse?.name ?? null,
        status: !assessment ? "NOT_ASSESSED" : assessment.payments.length ? "PAID" : "UNPAID",
      };
    });
    return { ok: true, results };
  }, { isolationLevel: "RepeatableRead", maxWait: 2_000, timeout: 5_000 });
}
