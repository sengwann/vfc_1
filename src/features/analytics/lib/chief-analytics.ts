import "server-only";
import { MembershipStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { aggregateAgeGroups, type AgeGroupCount } from "./age-calculator";

export interface ChiefDemographicData {
  ageGroups: AgeGroupCount[];
  totalMembers: number;
}

/**
 * Fetches aggregated demographic data for the Chief dashboard.
 *
 * SECURITY: Only fetches dateOfBirth. Does NOT fetch names, emails,
 * or any other personal identifiers. Returns only aggregated counts.
 * Individual DOBs and ages are never exposed to the client.
 */
export async function getChiefDemographicData(
  villageId: string,
): Promise<ChiefDemographicData> {
  // Fetch only dateOfBirth for active members in this village
  const members = await prisma.user.findMany({
    where: {
      villageId,
      membershipStatus: MembershipStatus.ACTIVE,
    },
    select: {
      dateOfBirth: true, // Only select DOB — no personal data
    },
  });

  const datesOfBirth = members.map((m) => m.dateOfBirth);
  const ageGroups = aggregateAgeGroups(datesOfBirth);

  return {
    ageGroups,
    totalMembers: members.length,
  };
}
