"use server";

import { MembershipStatus, PaymentStatus, UserRole } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { getCurrentUser } from "../../../lib/auth/session";
import { getActiveCollectorContext } from "../../../lib/authz";

export interface PaymentStatusSearchItem {
  id: string;
  houseNumber: string;
  headName: string | null;
  paid: boolean;
}

export type PaymentStatusSearchActionResult =
  | { ok: true; results: PaymentStatusSearchItem[] }
  | { ok: false; error: string };

function getFormDataString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value === "string") {
    return value;
  }
  return "";
}

export async function searchPaymentStatusAction(
  formData: FormData,
): Promise<PaymentStatusSearchActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }
  // This action reads the session directly, so it applies the forced
  // password change gate itself.
  if (user.mustChangePassword) {
    return { ok: false, error: "You must change your password first." };
  }
  if (user.role === UserRole.SYSTEM_ADMIN || !user.villageId) {
    return { ok: false, error: "Village not found." };
  }
  const villageId = user.villageId;

  // Only Chief or active Collector may search payment status.
  const isChiefUser =
    user.role === UserRole.CHIEF &&
    user.membershipStatus === MembershipStatus.ACTIVE;
  const collectorContext = await getActiveCollectorContext(user);
  const isActiveCollector = Boolean(collectorContext);
  if (!isChiefUser && !isActiveCollector) {
    return {
      ok: false,
      error: "You do not have permission to search payment status.",
    };
  }

  const query = getFormDataString(formData, "q").trim();
  const fundId = getFormDataString(formData, "fundId");

  if (!query) {
    return { ok: true, results: [] };
  }

  // Make sure the fund belongs to this village.
  const fund = await prisma.fund.findFirst({
    where: { id: fundId, villageId },
    select: { id: true },
  });
  if (!fund) {
    return { ok: false, error: "Fund not found." };
  }

  const matchedHouses = await prisma.house.findMany({
    where: {
      villageId,
      OR: [
        { houseNumber: { contains: query, mode: "insensitive" } },
        { headOfHouse: { name: { contains: query, mode: "insensitive" } } },
      ],
    },
    orderBy: { houseNumber: "asc" },
    select: {
      id: true,
      houseNumber: true,
      headOfHouse: { select: { name: true } },
      payments: {
        where: { fundId: fund.id, status: PaymentStatus.ACCEPTED },
        select: { id: true, status: true },
        take: 1,
      },
    },
  });

  const results = matchedHouses.map((house) => ({
    id: house.id,
    houseNumber: house.houseNumber,
    headName: house.headOfHouse?.name ?? null,
    paid: house.payments.length > 0,
  }));

  return { ok: true, results };
}
