import "server-only";
import type { FundStatus } from "@prisma/client";
import {
  assertTransactionClient,
  type FinancialTransactionClient,
} from "./village-scope";

export interface FinancialLockTarget {
  id: string;
  villageId: string;
}

export interface LockedFund extends FinancialLockTarget {
  status: FundStatus;
  termsVersion: number;
}

export interface LockedHouse extends FinancialLockTarget {
  isActive: boolean;
  headOfHouseId: string | null;
}

export class FinancialLockNotFoundError extends Error {
  readonly code = "VFC_LOCK_TARGET_NOT_FOUND";
  constructor() {
    super("Financial lock target not found in the requested Village");
  }
}

function orderedTargets(targets: readonly FinancialLockTarget[]): FinancialLockTarget[] {
  const unique = new Map<string, FinancialLockTarget>();
  for (const target of targets) {
    if (
      typeof target.id !== "string" || !target.id.trim() ||
      typeof target.villageId !== "string" || !target.villageId.trim()
    ) {
      throw new TypeError("Lock targets require nonempty entity and Village IDs");
    }
    const previous = unique.get(target.id);
    if (previous && previous.villageId !== target.villageId) {
      throw new TypeError("One entity cannot be locked through different Villages");
    }
    unique.set(target.id, { ...target });
  }
  return [...unique.values()].sort((a, b) => (
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  ));
}

/** All Village scopes and Village rows must already be acquired. Funds first. */
export async function lockFunds(
  tx: FinancialTransactionClient,
  targets: readonly FinancialLockTarget[],
): Promise<LockedFund[]> {
  assertTransactionClient(tx);
  const locked: LockedFund[] = [];
  for (const target of orderedTargets(targets)) {
    const rows = await tx.$queryRaw<LockedFund[]>`
      SELECT "id", "villageId", "status"::text AS "status", "termsVersion"
      FROM public."Fund" WHERE "id" = ${target.id} AND "villageId" = ${target.villageId}
      FOR UPDATE
    `;
    if (!rows[0]) throw new FinancialLockNotFoundError();
    locked.push(rows[0]);
  }
  return locked;
}

/** After ALL Fund locks, before User/assignment/Payment locks. */
export async function lockHouses(
  tx: FinancialTransactionClient,
  targets: readonly FinancialLockTarget[],
): Promise<LockedHouse[]> {
  assertTransactionClient(tx);
  const locked: LockedHouse[] = [];
  for (const target of orderedTargets(targets)) {
    const rows = await tx.$queryRaw<LockedHouse[]>`
      SELECT "id", "villageId", "isActive", "headOfHouseId"
      FROM public."House" WHERE "id" = ${target.id} AND "villageId" = ${target.villageId}
      FOR NO KEY UPDATE
    `;
    if (!rows[0]) throw new FinancialLockNotFoundError();
    locked.push(rows[0]);
  }
  return locked;
}
