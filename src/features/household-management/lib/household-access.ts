import "server-only";

import { MembershipStatus } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { requireAuthenticatedUser } from "../../../lib/auth/guards";
import { redirectForbidden } from "../../../lib/authz/authz.errors";
import type { SessionUser } from "../../../lib/auth/auth.types";

export interface HouseholdManagementHouse {
  id: string;
  villageId: string;
  houseNumber: string;
  isActive: boolean;
  headOfHouseId: string | null;
}

export interface HouseholdManagementContext {
  user: SessionUser;
  house: HouseholdManagementHouse;
}

export async function requireHouseholdManagementAccess(): Promise<HouseholdManagementContext> {
  const user = await requireAuthenticatedUser();

  if (
    !user.houseId ||
    !user.villageId ||
    user.membershipStatus !== MembershipStatus.ACTIVE
  ) {
    return redirectForbidden();
  }

  const house = await prisma.house.findUnique({
    where: {
      id: user.houseId,
    },
    select: {
      id: true,
      villageId: true,
      houseNumber: true,
      isActive: true,
      headOfHouseId: true,
    },
  });

  if (
    !house ||
    !house.isActive ||
    house.villageId !== user.villageId ||
    house.headOfHouseId !== user.id
  ) {
    return redirectForbidden();
  }

  return {
    user,
    house,
  };
}
