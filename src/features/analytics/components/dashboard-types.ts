import type { FundReportingMetrics } from "@/features/fund-management/lib/fund-reporting";
import type { HouseholdFundStatus } from "@/features/fund-management/lib/household-reporting-types";

export interface DashboardFund {
  id: string;
  name: string;
  villageTargetAmount: number;
  startDate: Date;
  endDate: Date;
}

export interface ChiefDashboardData {
  totalHouses: number;
  totalMembers: number;
  fundMetrics: FundReportingMetrics | null;
  currentCollectorName: string | null;
}

export interface ChiefDemographicsData {
  ageGroups: { group: string; count: number }[];
  totalMembers: number;
}

export interface CollectorDashboardData {
  lifetimeAcceptedCount: number;
}

export interface VillagerDashboardData {
  household: HouseholdFundStatus | null;
  recentPayments: {
    id: string;
    amount: number;
    status: string;
    createdAt: Date;
  }[];
  receiptsCount: number;
}
