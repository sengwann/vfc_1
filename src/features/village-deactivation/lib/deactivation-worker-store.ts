import { AuditActionType, type Prisma } from "@prisma/client";

import { AuditEntityType, createAuditLog } from "../../../lib/audit";
import type { WorkerStore } from "./deactivation-worker";

/*
 * The worker's database access (raw SQL because it needs FOR UPDATE SKIP LOCKED
 * and the database clock). Timestamps are TIMESTAMP(3) in UTC, so "now" is
 * clock_timestamp() converted to UTC, the same source readDatabaseNow uses.
 *
 * Nothing here touches Village or changes request status; completion happens
 * only through completeDeactivationRequest.
 */

type Client = Prisma.TransactionClient;

const NOW_UTC = `(clock_timestamp() AT TIME ZONE 'UTC')`;

export function createPrismaWorkerStore(client: Client): WorkerStore {
  return {
    async readNow() {
      const rows = await client.$queryRawUnsafe<{ now: Date }[]>(
        `SELECT ${NOW_UTC} AS now`,
      );
      return rows[0].now;
    },

    async claimDueRequests(limit, leaseSeconds) {
      const rows = await client.$queryRawUnsafe<{ id: string }[]>(
        `UPDATE "VillageDeactivationRequest" AS r
            SET "processingAttempts" = r."processingAttempts" + 1,
                "lastProcessingAt" = ${NOW_UTC},
                "updatedAt" = ${NOW_UTC}
          WHERE r.id IN (
            SELECT id FROM "VillageDeactivationRequest"
             WHERE status = 'APPROVED'
               AND "scheduledDeactivationAt" <= ${NOW_UTC}
               AND ("lastProcessingAt" IS NULL
                    OR "lastProcessingAt" < ${NOW_UTC} - make_interval(secs => $2))
             ORDER BY "scheduledDeactivationAt", id
             LIMIT $1
             FOR UPDATE SKIP LOCKED
          )
          RETURNING r.id`,
        limit,
        leaseSeconds,
      );
      return rows.map((row) => row.id);
    },

    async recordFailure(requestId, message, options) {
      const previous = await client.villageDeactivationRequest.findUnique({
        where: { id: requestId },
        select: {
          villageId: true,
          lastProcessingError: true,
          processingAttempts: true,
        },
      });

      await client.$executeRawUnsafe(
        `UPDATE "VillageDeactivationRequest"
            SET "lastProcessingError" = $2,
                "lastProcessingAt" = CASE WHEN $3 THEN NULL ELSE "lastProcessingAt" END,
                "updatedAt" = ${NOW_UTC}
          WHERE id = $1 AND status = 'APPROVED'`,
        requestId,
        message,
        options.retryNow,
      );

      // Audit trail for failed processing (rules, section 10). Only when the
      // error changes, so a persistent failure retried every pass does not
      // fill the audit log; the attempt count stays on the request row.
      if (previous && previous.lastProcessingError !== message) {
        await createAuditLog(client, {
          actionType: AuditActionType.UPDATE,
          entityType: AuditEntityType.DEACTIVATION_REQUEST,
          entityId: requestId,
          villageId: previous.villageId,
          actorUserId: null,
          metadata: {
            requestId,
            outcome: "BLOCKED",
            blockReason: "PROCESSING_FAILED",
            error: message,
            processingAttempts: previous.processingAttempts,
          },
        });
      }
    },

    async listReconcileRequestIds(limit, windowSeconds) {
      const rows = await client.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM "VillageDeactivationRequest"
          WHERE status IN ('PENDING', 'APPROVED')
             OR "updatedAt" > ${NOW_UTC} - make_interval(secs => $2)
          ORDER BY "updatedAt" DESC, id
          LIMIT $1`,
        limit,
        windowSeconds,
      );
      return rows.map((row) => row.id);
    },
  };
}
