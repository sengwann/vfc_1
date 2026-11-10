import {
  FundStatus,
  MembershipStatus,
  PaymentStatus,
  UserRole,
} from "@prisma/client";
import { ChiefContactCard } from "../../../../features/shell/components/chief-contact-card";
import { PaymentStatusSearchSection } from "../../../../features/fund-management/components/payment-status-search";
import { getVillageShellContext } from "../../../../features/shell/lib/shell-context";
import {
  getCurrentPeriod,
  hasActiveMembership,
  isChief,
  isVillager,
} from "../../../../lib/authz";
import { NeedsAttentionCard } from "../../../../features/shell/components/needs-attention-card";
import { prisma } from "../../../../lib/prisma";
import { getChiefDemographicData } from "@/features/analytics/lib/chief-analytics";
import { getCollectorChartData } from "@/features/analytics/lib/collector-analytics";
import {
  ChiefDemographics,
  ChiefOverview,
} from "@/features/analytics/components/chief-overview";
import {
  CollectorInsights,
  CollectorOverview,
} from "@/features/analytics/components/collector-overview";
import { DashboardHeader } from "@/features/analytics/components/dashboard-header";
import type {
  ChiefDashboardData,
  ChiefDemographicsData,
  CollectorDashboardData,
  VillagerDashboardData,
} from "@/features/analytics/components/dashboard-types";
import { PendingMembershipView } from "@/features/analytics/components/pending-membership-view";
import { VillagerOverview } from "@/features/analytics/components/villager-overview";

export const metadata = {
  title: "Village Dashboard | Village Fund Collection System",
};

export default async function VillageDashboardPage() {
  const {
    context,
    collectorContext,
    isHeadOfHouse,
    awaitingChiefApproval,
    notifications,
  } = await getVillageShellContext();
  const user = context.user;
  const villageId = context.villageId;
  const chief = isChief(user);
  const villager = isVillager(user);
  const activeMembership = hasActiveMembership(user);
  const collector = Boolean(collectorContext);
  const pendingMembership = user.membershipStatus === MembershipStatus.PENDING;

  // ── Pending membership: limited view ──────────────────────────
  if (pendingMembership) {
    return (
      <div className="space-y-6">
        <DashboardHeader name={user.name} pending />
        <PendingMembershipView awaitingChiefApproval={awaitingChiefApproval} />
      </div>
    );
  }

  // ── Current active fund (shared across roles) ─────────────────
  const currentFundRecord = await prisma.fund.findFirst({
    where: { villageId, status: FundStatus.ACTIVE },
    select: {
      id: true,
      name: true,
      villageTargetAmount: true,
      startDate: true,
      endDate: true,
    },
  });

  // Preserve the dashboard's presentation contract with the village-wide target.
  const currentFund = currentFundRecord
    ? {
        id: currentFundRecord.id,
        name: currentFundRecord.name,
        targetAmount: currentFundRecord.villageTargetAmount,
        startDate: currentFundRecord.startDate,
        endDate: currentFundRecord.endDate,
      }
    : null;

  // Village Chief contact — scoped to the session user's village.
  const chiefContact = await prisma.user.findFirst({
    where: {
      villageId,
      role: UserRole.CHIEF,
    },
    select: {
      name: true,
      phone: true,
    },
  });

  // ── Chief data ────────────────────────────────────────────────
  let chiefData: ChiefDashboardData | null = null;

  if (chief && activeMembership) {
    const currentPeriod = getCurrentPeriod();

    const [totalHouses, totalMembers, currentCollector] = await Promise.all([
      prisma.house.count({ where: { villageId, isActive: true } }),
      prisma.user.count({
        where: { villageId, membershipStatus: MembershipStatus.ACTIVE },
      }),
      prisma.collectorAssignment.findFirst({
        where: {
          villageId,
          year: currentPeriod.year,
          month: currentPeriod.month,
          isActive: true,
        },
        select: { user: { select: { name: true } } },
      }),
    ]);

    let totalCollected = 0;
    if (currentFund) {
      const result = await prisma.payment.aggregate({
        where: {
          villageId,
          fundId: currentFund.id,
          status: PaymentStatus.ACCEPTED,
        },
        _sum: { amount: true },
      });
      totalCollected = result._sum.amount ?? 0;
    }

    chiefData = {
      totalHouses,
      totalMembers,
      totalCollected,
      currentCollectorName: currentCollector?.user.name ?? null,
    };
  }

  let chiefDemographics: ChiefDemographicsData | null = null;
  if (chief && activeMembership) {
    chiefDemographics = await getChiefDemographicData(villageId);
  }

  // ── Collector data ────────────────────────────────────────────
  let collectorData: CollectorDashboardData | null = null;

  if (collector && collectorContext) {
    const [acceptedCount] = await Promise.all([
      prisma.payment.count({
        where: {
          villageId,
          status: PaymentStatus.ACCEPTED,
          collectorUserId: user.id,
        },
      }),
    ]);

    collectorData = { acceptedCount };
  }

  let collectorChartData: Awaited<
    ReturnType<typeof getCollectorChartData>
  > | null = null;
  if (collector && collectorContext) {
    collectorChartData = await getCollectorChartData(villageId, user.id);
  }

  // ── Villager data ─────────────────────────────────────────────
  let villagerData: VillagerDashboardData | null = null;

  if (villager && activeMembership) {
    let paymentStatus: PaymentStatus | null = null;
    if (currentFund && user.houseId) {
      const myPayment = await prisma.payment.findFirst({
        where: {
          villageId,
          fundId: currentFund.id,
          houseId: user.houseId,
          status: PaymentStatus.ACCEPTED,
        },
        select: { status: true },
      });
      paymentStatus = myPayment?.status ?? null;
    }

    const [recentPayments, receiptsCount] = await Promise.all([
      prisma.payment.findMany({
        where: { payerUserId: user.id, villageId },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          amount: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.receipt.count({
        where: { villageId, payment: { payerUserId: user.id } },
      }),
    ]);

    villagerData = {
      paymentStatus,
      recentPayments,
      receiptsCount,
    };
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <DashboardHeader name={user.name} />

      <NeedsAttentionCard
        isChief={chief && activeMembership}
        isHeadOfHouse={isHeadOfHouse}
        notifications={notifications}
      />

      {chief && chiefData ? (
        <ChiefOverview data={chiefData} fund={currentFund} />
      ) : null}

      {collector && collectorContext && collectorData ? (
        <CollectorOverview
          data={collectorData}
          period={{
            year: collectorContext.assignment.year,
            month: collectorContext.assignment.month,
          }}
        />
      ) : null}

      {currentFund && (chief || collector) ? (
        <PaymentStatusSearchSection fundId={currentFund.id} />
      ) : null}

      {villager && activeMembership && villagerData ? (
        <VillagerOverview data={villagerData} fund={currentFund} />
      ) : null}

      {collector && collectorChartData ? (
        <CollectorInsights data={collectorChartData} />
      ) : null}

      {chief && chiefDemographics ? (
        <ChiefDemographics data={chiefDemographics} />
      ) : null}

      <ChiefContactCard
        chiefName={chiefContact?.name ?? null}
        chiefPhone={chiefContact?.phone ?? null}
      />
    </div>
  );
}
