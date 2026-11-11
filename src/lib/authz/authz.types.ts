import type { SessionUser } from "../auth/auth.types";
import type { VillageStatus } from "@prisma/client";

export type AuthzErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INACTIVE_VILLAGE"
  | "VILLAGE_READ_ONLY"
  | "INACTIVE_MEMBERSHIP"
  | "MISSING_COLLECTOR_ASSIGNMENT"
  | "TENANT_MISMATCH";

export interface VillageContext {
  user: SessionUser;
  villageId: string;
}

export interface CollectorAssignmentContext {
  id: string;
  villageId: string;
  year: number;
  month: number;
}

export interface CollectorContext extends VillageContext {
  assignment: CollectorAssignmentContext;
}

export type HouseAccessLevel = "chief" | "activeCollector" | "member" | "head";

export interface HouseAccessOptions {
  allowed: HouseAccessLevel[];
  requireActiveHouse?: boolean;
}

export interface HouseAccessResult {
  id: string;
  villageId: string;
  isActive: boolean;
  headOfHouseId: string | null;
}

export interface VillageLifecycleContext {
  id: string;
  villageCode: string;
  name: string;
  status: VillageStatus;
  createdAt: Date;
  updatedAt: Date;
}
