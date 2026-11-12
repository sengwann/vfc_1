import "server-only";
import type { Prisma } from "@prisma/client";

// Root PrismaClient structurally satisfies TransactionClient: exclude its
// lifecycle methods too, preventing accidental nontransactional acquisition.
export type FinancialTransactionClient = Prisma.TransactionClient;

export function assertTransactionClient(tx: FinancialTransactionClient): void {
  const client = tx as unknown as {
    $connect?: unknown;
    $disconnect?: unknown;
  };

  if (
    typeof client.$connect === "function" ||
    typeof client.$disconnect === "function"
  ) {
    throw new TypeError("An interactive transaction client is required");
  }
}
export function orderedVillageIds(villageIds: readonly string[]): string[] {
  if (!Array.isArray(villageIds)) {
    throw new TypeError("Village IDs must be supplied as an array");
  }
  const validated: string[] = [];
  for (let index = 0; index < villageIds.length; index += 1) {
    // Check own positions: .some() skips holes, and inherited array entries
    // must not turn a sparse input into an apparently valid scope list.
    if (!Object.prototype.hasOwnProperty.call(villageIds, index)) {
      throw new TypeError("Village IDs must not contain empty slots");
    }
    const id = villageIds[index];
    if (typeof id !== "string" || id.trim().length === 0 || id.includes("\0")) {
      throw new TypeError(
        "Village IDs must be nonempty strings without NUL characters",
      );
    }
    validated.push(id);
  }
  return [...new Set(validated)].sort();
}

/** Call once at entry with ALL scopes, before any entity locks or decisions. */
export async function acquireVillageScopes(
  tx: FinancialTransactionClient,
  villageIds: readonly string[],
): Promise<void> {
  assertTransactionClient(tx);
  const ids = orderedVillageIds(villageIds);
  if (ids.length === 0)
    throw new RangeError("At least one Village scope is required");
  // Single array parameter; cast PostgreSQL void for Prisma/pg decoding.
  await tx.$queryRaw`
    SELECT public.vfc_acquire_villages(${ids}::text[])::text AS lock
  `;
}
