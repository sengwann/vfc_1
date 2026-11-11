import "server-only";
import { type Prisma, VillageStatus } from "@prisma/client";
import { evaluateVillageWrite, type VillageWriteEvaluation } from "../../features/village-deactivation/lib/village-deactivation-rules";

/**
 * THE canonical village mutation guard. Every village-scoped write calls it
 * INSIDE its write transaction, before touching any village data.
 *
 * It reads from the database (never the session or a cache) in two separate
 * statements, on purpose:
 *
 *   1. SELECT status FROM "Village" ... FOR SHARE. Takes a shared row lock, so
 *      a concurrent approval (which UPDATEs this row) waits for this
 *      transaction, and this transaction waits for an approval already in
 *      flight. In a Serializable transaction a village row that changed after
 *      the snapshot makes this statement fail with 40001, and
 *      withSerializableRetry runs the whole mutation again.
 *   2. A separate EXISTS on an APPROVED request. It must be its own statement:
 *      under READ COMMITTED it then gets a fresh snapshot that already sees an
 *      approval committed while statement 1 was waiting. A single combined
 *      statement would keep the stale snapshot.
 *
 * The caller ends the transaction on { ok: false } and answers with a
 * machine-readable error: VILLAGE_INACTIVE (existing behavior) or
 * VILLAGE_READ_ONLY (see VILLAGE_READ_ONLY_CODE).
 */
export async function guardVillageWrite(
  tx: Prisma.TransactionClient,
  villageId: string,
): Promise<VillageWriteEvaluation> {
  const villages = await tx.$queryRaw<{ status: string }[]>`
    SELECT "status"::text AS "status"
    FROM "Village"
    WHERE "id" = ${villageId}
    FOR SHARE
  `;
  const villageStatus = villages[0]?.status ?? null;

  if (villageStatus !== VillageStatus.ACTIVE) {
    return evaluateVillageWrite({ villageStatus, hasApprovedRequest: false });
  }

  const approved = await tx.$queryRaw<{ found: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM "VillageDeactivationRequest"
      WHERE "villageId" = ${villageId}
        AND "status" = 'APPROVED'::"DeactivationRequestStatus"
    ) AS "found"
  `;

  return evaluateVillageWrite({
    villageStatus,
    hasApprovedRequest: approved[0]?.found === true,
  });
}
