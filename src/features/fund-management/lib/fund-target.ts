import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

export type AmountPerHouseResult =
  | { ok: true; amountPerHouse: number; numberOfHouse: number }
  | { ok: false; error: string };

export function calculateAmountPerHouse(
  totalAmount: number,
  numberOfHouse: number,
): AmountPerHouseResult {
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    return { ok: false, error: "Total amount must be a positive number." };
  }
  if (
    !Number.isFinite(numberOfHouse) ||
    !Number.isInteger(numberOfHouse) ||
    numberOfHouse <= 0
  ) {
    return {
      ok: false,
      error:
        "Cannot calculate the per-house amount because the village has no active houses yet.",
    };
  }
  return {
    ok: true,
    amountPerHouse: Math.ceil(totalAmount / numberOfHouse),
    numberOfHouse,
  };
}

export async function getFundAmountPerHouse(
  client: PrismaClient | Prisma.TransactionClient,
  villageId: string,
  totalAmount: number,
): Promise<AmountPerHouseResult> {
  const numberOfHouse = await client.house.count({
    where: { villageId, isActive: true },
  });
  return calculateAmountPerHouse(totalAmount, numberOfHouse);
}
