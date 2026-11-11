import { notFound } from "next/navigation";
import { requireChief } from "@/lib/authz";
import { requireSameVillage } from "@/lib/authz/tenant";
import { prisma } from "@/lib/prisma";
import { MembershipStatus, UserRole } from "@prisma/client";
import { chiefApproveFirstMemberAction } from "@/features/household-management/actions/chief-approve-first-member.action";
import { chiefRejectPendingMemberAction } from "@/features/household-management/actions/chief-reject-pending-member.action";
import { HouseDetailView } from "@/features/house-management/components/house-detail-view";
import {
  canDeactivateHouse,
  canEditHouseNumber,
  canReactivateHouse,
} from "@/features/house-management/lib/house-rules";

export const metadata = {
  title: "House Detail | Village Fund Collection System",
};

type RouteParams = Record<string, string | string[] | undefined>;

async function extractHouseId(rawParams: unknown): Promise<string> {
  if (!rawParams) return "";
  let params: RouteParams;
  const maybePromise = rawParams as { then?: unknown };
  if (typeof maybePromise.then === "function") {
    params = await (rawParams as Promise<RouteParams>);
  } else {
    params = rawParams as RouteParams;
  }
  const houseId = params.houseId;
  if (Array.isArray(houseId)) return houseId[0] ?? "";
  return houseId ?? "";
}

export default async function HouseDetailPage({ params }: { params: unknown }) {
  const ctx = await requireChief();
  const houseId = await extractHouseId(params);
  if (!houseId) return notFound();

  const house = await prisma.house.findUnique({
    where: { id: houseId },
    select: {
      id: true,
      villageId: true,
      houseNumber: true,
      isActive: true,
      headOfHouseId: true,
      createdAt: true,
      updatedAt: true,
      headOfHouse: {
        select: { name: true },
      },
      _count: {
        select: {
          payments: true,
          members: {
            where: {
              membershipStatus: {
                in: [MembershipStatus.ACTIVE, MembershipStatus.PENDING],
              },
            },
          },
        },
      },
    },
  });

  if (!house) return notFound();
  requireSameVillage(ctx, house.villageId);

  // Rules are evaluated on the server (house-rules.ts is server-only); the
  // view only receives the results. Payment history does not affect them.
  const flags = {
    isActive: house.isActive,
    hasActiveOrPendingMembers: house._count.members > 0,
  };

  // A house with no head has its pending members decided by the Chief, oldest
  // first. Once a head exists, the head handles them and this stays empty.
  const pendingHeadCandidates =
    house.headOfHouseId === null
      ? (
          await prisma.user.findMany({
            where: {
              houseId: house.id,
              villageId: house.villageId,
              role: UserRole.VILLAGER,
              membershipStatus: MembershipStatus.PENDING,
            },
            select: {
              id: true,
              name: true,
              createdAt: true,
            },
            orderBy: {
              createdAt: "asc",
            },
          })
        ).map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
          createdAt: candidate.createdAt.toISOString(),
        }))
      : [];

  return (
    <HouseDetailView
      chiefApproveAction={chiefApproveFirstMemberAction}
      chiefRejectAction={chiefRejectPendingMemberAction}
      house={{
        id: house.id,
        houseNumber: house.houseNumber,
        isActive: house.isActive,
        headOfHouseName: house.headOfHouse ? house.headOfHouse.name : null,
        memberCount: house._count.members,
        paymentCount: house._count.payments,
        createdAt: house.createdAt.toISOString(),
        updatedAt: house.updatedAt.toISOString(),
      }}
      pendingHeadCandidates={pendingHeadCandidates}
      rules={{
        flags,
        edit: canEditHouseNumber(),
        deactivate: canDeactivateHouse(flags),
        reactivate: canReactivateHouse(flags),
      }}
    />
  );
}
