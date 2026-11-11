export interface DashboardFund {
  id: string;
  name: string;
  targetAmount: number;
  startDate: Date;
  endDate: Date;
}

export interface ChiefDashboardData {
  totalHouses: number;
  totalMembers: number;
  totalCollected: number;
  currentCollectorName: string | null;
}

export interface ChiefDemographicsData {
  ageGroups: { group: string; count: number }[];
  totalMembers: number;
}

export interface CollectorDashboardData {
  acceptedCount: number;
}

export interface VillagerDashboardData {
  paymentStatus: string | null;
  recentPayments: {
    id: string;
    amount: number;
    status: string;
    createdAt: Date;
  }[];
  receiptsCount: number;
}
