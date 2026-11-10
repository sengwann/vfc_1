import "server-only";
import { FundStatus } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { requireActiveCollector } from "../../../lib/authz";

export async function requireCashPaymentAccess() {
  const collector = await requireActiveCollector();
  const villageId = collector.villageId;

  const fund = await prisma.fund.findFirst({
    where: {
      villageId,
      status: FundStatus.ACTIVE,
    },
    select: {
      id: true,
      name: true,
      villageTargetAmount: true,
      termsVersion: true,
      assessmentPerHouse: true,
      assessments: {
        where: { villageId },
        orderBy: [{ houseNumberSnapshot: "asc" }, { id: "asc" }],
        select: {
          id: true, houseId: true, houseNumberSnapshot: true, assessmentAmount: true,
          house: { select: { members: {
            where: { villageId, membershipStatus: "ACTIVE" },
            orderBy: [{ name: "asc" }, { id: "asc" }],
            select: { id: true, name: true },
          } } },
        },
      },
    },
  });

  return {
    collector,
    villageId,
    fund,
  };
}

export type CashPaymentAccessContext = Awaited<ReturnType<typeof requireCashPaymentAccess>>;
