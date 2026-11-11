/*
 * The deactivation worker against a real, disposable PostgreSQL database.
 * Skipped unless TEST_DATABASE_URL is set (see src/test-support/test-database.ts).
 * Unique ids; only the rows this file creates are deleted.
 *
 * Caveat: the claim query takes every due request in the database. Run this
 * against the dedicated test database only (the helper enforces that).
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { withSerializableRetry } from "@/lib/db/transaction";
import {
  TrackedIds,
  openTestDatabase,
  type TestDatabase,
} from "@/test-support/test-database";

import {
  runWorkerPass,
  type WorkerDeps,
  type WorkerStore,
} from "./deactivation-worker";
import { createPrismaWorkerStore } from "./deactivation-worker-store";
import {
  approveDeactivationRequestInTx,
  cancelDeactivationRequestInTx,
  completeDeactivationRequestInTx,
  submitDeactivationRequestInTx,
} from "./deactivation-transitions";

const HOUR = 60 * 60 * 1000;
const SERIALIZABLE = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const;

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "deactivation worker (real database)",
  () => {
    let db: TestDatabase;
    let store: WorkerStore;
    const ids = new TrackedIds();
    let adminId: string;
    const uid = (label: string) => `itest-${label}-${randomUUID()}`;
    const run = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      withSerializableRetry(() => db.prisma.$transaction(fn, SERIALIZABLE));

    const workerDeps = (): WorkerDeps => ({
      store,
      complete: (requestId) =>
        run((tx) => completeDeactivationRequestInTx(tx, { requestId })),
      deliver: async () => ({ planned: 0, created: 0 }),
      batchSize: 50,
    });

    /** An APPROVED request whose deadline is `deadlineOffsetMs` from the real now. */
    async function approvedRequest(deadlineOffsetMs: number) {
      const villageId = uid("village");
      const chiefId = uid("chief");
      ids.villages.push(villageId);
      ids.users.push(chiefId);
      await db.pool.query(
        `INSERT INTO "Village"(id, "villageCode", name, "updatedAt")
         VALUES ($1, $2, 'Worker test village', now())`,
        [villageId, `IT-${randomUUID()}`],
      );
      await db.pool.query(
        `INSERT INTO "User"(id, "villageId", name, "passwordHash", role, "membershipStatus", "updatedAt")
         VALUES ($1, $2, 'Test chief', 'x', 'CHIEF', 'ACTIVE', now())`,
        [chiefId, villageId],
      );
      const submitted = await run((tx) =>
        submitDeactivationRequestInTx(tx, { actorUserId: chiefId, villageId, reason: "integration" }),
      );
      if (submitted.kind !== "created") throw new Error(`submit: ${submitted.kind}`);
      ids.requests.push(submitted.requestId);

      // Approve "in the past" so the stored deadline lands where the test wants it.
      const approvedAt = new Date(Date.now() + deadlineOffsetMs - 24 * HOUR);
      const approved = await run((tx) =>
        approveDeactivationRequestInTx(tx, {
          requestId: submitted.requestId,
          actorUserId: adminId,
          now: approvedAt,
        }),
      );
      if (approved.kind !== "approved") throw new Error(`approve: ${approved.kind}`);
      return { requestId: submitted.requestId, villageId, chiefId };
    }

    const states = async (requestId: string, villageId: string) => ({
      request: (
        await db.pool.query<{ status: string; attempts: number; err: string | null }>(
          `SELECT status::text, "processingAttempts" AS attempts, "lastProcessingError" AS err
             FROM "VillageDeactivationRequest" WHERE id = $1`,
          [requestId],
        )
      ).rows[0],
      village: (
        await db.pool.query<{ status: string }>(
          `SELECT status::text FROM "Village" WHERE id = $1`,
          [villageId],
        )
      ).rows[0].status,
    });

    beforeAll(async () => {
      db = await openTestDatabase();
      store = createPrismaWorkerStore(db.prisma);
      adminId = uid("admin");
      ids.users.push(adminId);
      await db.pool.query(
        `INSERT INTO "User"(id, name, "passwordHash", role, "updatedAt")
         VALUES ($1, 'Worker admin', 'x', 'SYSTEM_ADMIN', now())`,
        [adminId],
      );
    });

    afterAll(async () => {
      if (!db) return;
      try {
        await ids.cleanup(db.pool);
      } finally {
        await db.close();
        await db.pool.end();
      }
    });

    it("completes a due request and leaves one that is not due yet", async () => {
      const due = await approvedRequest(-HOUR);
      const later = await approvedRequest(5 * HOUR);

      const result = await runWorkerPass(workerDeps());

      expect(result.completed).toBeGreaterThanOrEqual(1);
      expect(await states(due.requestId, due.villageId)).toMatchObject({
        request: { status: "COMPLETED" },
        village: "DEACTIVATED",
      });
      expect(await states(later.requestId, later.villageId)).toMatchObject({
        request: { status: "APPROVED", attempts: 0 },
        village: "ACTIVE",
      });
    });

    it("a second pass changes nothing (idempotent)", async () => {
      const due = await approvedRequest(-HOUR);
      await runWorkerPass(workerDeps());
      const before = await states(due.requestId, due.villageId);

      await runWorkerPass(workerDeps());

      expect(await states(due.requestId, due.villageId)).toEqual(before);
    });

    it("never completes a request cancelled before its deadline", async () => {
      const { requestId, villageId, chiefId } = await approvedRequest(2 * HOUR);
      const cancelled = await run((tx) =>
        cancelDeactivationRequestInTx(tx, { requestId, villageId, actorUserId: chiefId, reason: "keep" }),
      );
      expect(cancelled.kind).toBe("cancelled");

      await runWorkerPass(workerDeps());

      expect(await states(requestId, villageId)).toMatchObject({
        request: { status: "CANCELLED" },
        village: "ACTIVE",
      });
    });

    it("two workers at once complete each request exactly once", async () => {
      const first = await approvedRequest(-HOUR);
      const second = await approvedRequest(-2 * HOUR);

      const [a, b] = await Promise.all([
        runWorkerPass(workerDeps()),
        runWorkerPass(workerDeps()),
      ]);

      expect(a.failed + b.failed).toBe(0);
      for (const item of [first, second]) {
        expect(await states(item.requestId, item.villageId)).toMatchObject({
          request: { status: "COMPLETED", attempts: 1 },
          village: "DEACTIVATED",
        });
      }
    });

    it("a failure is recorded and released for retry; the lease holds back an unreleased claim", async () => {
      const { requestId, villageId } = await approvedRequest(-HOUR);
      const failing: WorkerDeps = {
        ...workerDeps(),
        complete: async () => {
          throw new Error("simulated failure");
        },
      };

      const first = await runWorkerPass(failing);
      expect(first.failed).toBeGreaterThanOrEqual(1);
      expect(await states(requestId, villageId)).toMatchObject({
        request: { status: "APPROVED", attempts: 1, err: "simulated failure" },
        village: "ACTIVE",
      });

      // The failure is in the audit log, once per distinct error.
      const audits = await db.pool.query(
        `SELECT metadata FROM "AuditLog"
          WHERE "entityId" = $1 AND metadata->>'blockReason' = 'PROCESSING_FAILED'`,
        [requestId],
      );
      expect(audits.rows).toHaveLength(1);
      expect(audits.rows[0].metadata.error).toBe("simulated failure");

      // The claim was released (retryNow), so the next pass picks it up and succeeds.
      await runWorkerPass(workerDeps());
      expect(await states(requestId, villageId)).toMatchObject({
        request: { status: "COMPLETED", attempts: 2 },
        village: "DEACTIVATED",
      });
    });
  },
);

// This legacy suite isolates state-machine behavior. Session/row-lock authority
// is exercised through the actual helper in lifecycle-authority tests.
vi.mock("@/features/village-management/lib/lifecycle-authority", () => ({
  hasLifecycleAuthority: async (tx: import("@prisma/client").Prisma.TransactionClient, id: string, role: string, villageId?: string) => {
    const actor = await tx.user.findUnique({ where: { id } });
    return Boolean(actor && actor.role === role && (role === "SYSTEM_ADMIN" || (actor.villageId === villageId && actor.membershipStatus === "ACTIVE")));
  },
}));
