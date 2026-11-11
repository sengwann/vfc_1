import { notFound, redirect } from "next/navigation";
import { requireChief } from "@/lib/authz";
import { requireSameVillage } from "@/lib/authz/tenant";
import { prisma } from "@/lib/prisma";
import { EditHouseNumberForm } from "@/features/house-management/components/edit-house-number-form";
import { canEditHouseNumber } from "@/features/house-management/lib/house-rules";

export const metadata = {
  title: "Edit House | Village Fund Collection System",
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

export default async function EditHousePage({ params }: { params: unknown }) {
  const ctx = await requireChief();
  const houseId = await extractHouseId(params);
  if (!houseId) return notFound();

  const house = await prisma.house.findUnique({
    where: { id: houseId },
    select: {
      id: true,
      villageId: true,
      houseNumber: true,
    },
  });

  if (!house) return notFound();
  requireSameVillage(ctx, house.villageId);

  const rules = canEditHouseNumber();

  if (!rules.allowed) {
    redirect(`/village/houses/${houseId}`);
  }

  return (
    <EditHouseNumberForm
      currentHouseNumber={house.houseNumber}
      houseId={house.id}
    />
  );
}
