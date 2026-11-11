import { cache } from "react";
import {
  LanguagePreference,
  MembershipStatus,
  UserRole,
} from "@prisma/client";
import {
  getActiveCollectorContext,
  requireSystemAdmin,
  requireVillageContext,
} from "../../../lib/authz";
import { redirectForbidden } from "../../../lib/authz/authz.errors";
import type { CollectorContext, VillageContext } from "../../../lib/authz";
import type { SessionUser } from "../../../lib/auth/auth.types";
import { prisma } from "../../../lib/prisma";
import {
  computeNotificationSummary,
  type NotificationSummary,
} from "../../notifications/lib/notification-service";

export interface PlatformShellContext {
  user: SessionUser;
  language: LanguagePreference;
}

export interface VillageShellContext {
  context: VillageContext;
  collectorContext: CollectorContext | null;
  isHeadOfHouse: boolean;
  /**
   * True for a PENDING villager whose house has no Head of House yet, so the
   * Village Chief (not a head) decides on the request.
   */
  awaitingChiefApproval: boolean;
  notifications: NotificationSummary;
  language: LanguagePreference;
}

async function loadUserPreferences(userId: string): Promise<{
  language: LanguagePreference;
}> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { language: true },
  });
  return {
    language: settings?.language ?? LanguagePreference.EN,
  };
}

export const getPlatformShellContext = cache(
  async (): Promise<PlatformShellContext> => {
    const user = await requireSystemAdmin();
    const { language } = await loadUserPreferences(user.id);
    return { user, language };
  },
);

export const getVillageShellContext = cache(
  async (): Promise<VillageShellContext> => {
    const context = await requireVillageContext();
    if (
      context.user.membershipStatus === MembershipStatus.REJECTED ||
      context.user.membershipStatus === MembershipStatus.REMOVED
    ) {
      return redirectForbidden();
    }
    const collectorContext = await getActiveCollectorContext(context.user);
    let isHeadOfHouse = false;
    let awaitingChiefApproval = false;
    if (
      context.user.houseId &&
      (context.user.membershipStatus === MembershipStatus.ACTIVE ||
        context.user.membershipStatus === MembershipStatus.PENDING)
    ) {
      const house = await prisma.house.findUnique({
        where: { id: context.user.houseId },
        select: { isActive: true, headOfHouseId: true },
      });
      if (context.user.membershipStatus === MembershipStatus.ACTIVE) {
        isHeadOfHouse = Boolean(
          house && house.isActive && house.headOfHouseId === context.user.id,
        );
      } else {
        awaitingChiefApproval =
          context.user.role === UserRole.VILLAGER &&
          Boolean(house && house.headOfHouseId === null);
      }
    }
    const notifications = await computeNotificationSummary({
      user: context.user,
      villageId: context.villageId,
      isHeadOfHouse,
    });
    const { language } = await loadUserPreferences(context.user.id);
    return {
      context,
      collectorContext,
      isHeadOfHouse,
      awaitingChiefApproval,
      notifications,
      language,
    };
  },
);