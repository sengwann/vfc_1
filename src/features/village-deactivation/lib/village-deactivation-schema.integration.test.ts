/*
 * Schema-level tests for the Village Deactivation Workflow against a real,
 * disposable PostgreSQL database (see src/test-support/test-database.ts).
 *
 * Skipped unless TEST_DATABASE_URL is set, so the normal `npm test` run does
 * not need a database. Run with `npm run test:integration` after
 * `npm run db:test:prepare`.
 *
 * What this covers is what only the database can enforce: the one-unresolved-
 * request-per-village partial unique index, the per-status CHECK constraints
 * (including the fixed 24 hour countdown), notification dedupe and the
 * RESTRICT foreign keys. It does not truncate or reset anything: every row has
 * a unique id and only those ids are deleted afterwards.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  TrackedIds,
  openTestDatabase,
  type TestDatabase,
} from "@/test-support/test-database";

const HOUR = 60 * 60 * 1000;

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "village deactivation schema (real database)",
  () => {
    let db: TestDatabase;
    const ids = new TrackedIds();
    let adminId: string;

    const uid = (label: string) => `itest-${label}-${randomUUID()}`;

    async function newVillage(): Promise<string> {
      const id = uid("village");
      ids.villages.push(id);
      await db.pool.query(
        `INSERT INTO "Village"(id, "villageCode", name, "updatedAt")
         VALUES ($1, $2, $3, now())`,
        [id, `IT-${randomUUID()}`, "Integration test village"],
      );
      return id;
    }

    async function newPending(villageId: string): Promise<string> {
      const id = uid("request");
      ids.requests.push(id);
      await db.pool.query(
        `INSERT INTO "VillageDeactivationRequest"
           (id, "villageId", "requesterUserId", reason, "updatedAt")
         VALUES ($1, $2, $3, 'integration test', now())`,
        [id, villageId, adminId],
      );
      return id;
    }

    /** Timestamps are TIMESTAMP(3) UTC, so keep them whole milliseconds. */
    const approvedAt = new Date("2026-10-28T10:00:00.000Z");
    const deadline = new Date(approvedAt.getTime() + 24 * HOUR);

    async function approve(requestId: string, scheduled: Date | null) {
      return db.pool.query(
        `UPDATE "VillageDeactivationRequest"
            SET status = 'APPROVED', "approvedByUserId" = $2,
                "approvedAt" = $3, "scheduledDeactivationAt" = $4
          WHERE id = $1`,
        [requestId, adminId, approvedAt, scheduled],
      );
    }

    async function newApproved(): Promise<{ villageId: string; requestId: string }> {
      const villageId = await newVillage();
      const requestId = await newPending(villageId);
      await approve(requestId, deadline);
      return { villageId, requestId };
    }

    /** The constraint name carried by a Postgres error, or the message. */
    async function constraintOf(promise: Promise<unknown>): Promise<string> {
      try {
        await promise;
      } catch (error) {
        const e = error as { constraint?: string; message?: string };
        return e.constraint ?? e.message ?? "unknown error";
      }
      return "NO_ERROR";
    }

    beforeAll(async () => {
      db = await openTestDatabase();
      adminId = uid("admin");
      ids.users.push(adminId);
      await db.pool.query(
        `INSERT INTO "User"(id, name, "passwordHash", role, "updatedAt")
         VALUES ($1, 'Integration admin', 'x', 'SYSTEM_ADMIN', now())`,
        [adminId],
      );
    });

    afterAll(async () => {
      if (!db) {
        return;
      }
      try {
        await ids.cleanup(db.pool);
      } finally {
        await db.close();
        await db.pool.end();
      }
    });

    it("blocks a second PENDING or APPROVED request for the same village", async () => {
      const villageId = await newVillage();
      const first = await newPending(villageId);

      expect(await constraintOf(newPending(villageId))).toBe(
        "VillageDeactivationRequest_villageId_unresolved_key",
      );

      await approve(first, deadline);

      expect(await constraintOf(newPending(villageId))).toBe(
        "VillageDeactivationRequest_villageId_unresolved_key",
      );
    });

    it("lets two concurrent submissions create exactly one request", async () => {
      const villageId = await newVillage();
      const results = await Promise.allSettled([
        newPending(villageId),
        newPending(villageId),
      ]);

      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    });

    it("lets different villages each have their own unresolved request", async () => {
      await newPending(await newVillage());
      await newPending(await newVillage());
    });

    it("rejects an approval whose deadline is not exactly approvedAt + 24h", async () => {
      for (const offset of [-60_000, 60_000]) {
        const requestId = await newPending(await newVillage());

        expect(
          await constraintOf(
            approve(requestId, new Date(deadline.getTime() + offset)),
          ),
        ).toBe("VillageDeactivationRequest_approved_shape_check");
      }
    });

    it("rejects an approval with no deadline (NULL does not slip past the CHECK)", async () => {
      const requestId = await newPending(await newVillage());

      expect(await constraintOf(approve(requestId, null))).toBe(
        "VillageDeactivationRequest_approved_shape_check",
      );
    });

    it("rejects a blank rejection reason and a cooldown that ends before the rejection", async () => {
      const requestId = await newPending(await newVillage());
      const reject = (reason: string, cooldownEndsAt: Date) =>
        db.pool.query(
          `UPDATE "VillageDeactivationRequest"
              SET status = 'REJECTED', "rejectedByUserId" = $2,
                  "rejectedAt" = $3, "rejectionReason" = $4,
                  "cooldownEndsAt" = $5
            WHERE id = $1`,
          [requestId, adminId, approvedAt, reason, cooldownEndsAt],
        );

      expect(await constraintOf(reject("   ", deadline))).toBe(
        "VillageDeactivationRequest_rejected_shape_check",
      );
      expect(
        await constraintOf(reject("No", new Date(approvedAt.getTime() - HOUR))),
      ).toBe("VillageDeactivationRequest_rejected_shape_check");

      await reject("Not needed", deadline);
    });

    it("lets a village submit again after a REJECTED or CANCELLED request", async () => {
      const villageId = await newVillage();
      const requestId = await newPending(villageId);

      await db.pool.query(
        `UPDATE "VillageDeactivationRequest"
            SET status = 'REJECTED', "rejectedByUserId" = $2,
                "rejectedAt" = $3, "rejectionReason" = 'No',
                "cooldownEndsAt" = $4
          WHERE id = $1`,
        [requestId, adminId, approvedAt, deadline],
      );

      // The database allows it; the cooldown itself is enforced by the service.
      await newPending(villageId);
    });

    it("cancels strictly before the deadline, never at or after it", async () => {
      const { requestId } = await newApproved();
      const cancel = (cancelledAt: Date, reason = "Changed our mind") =>
        db.pool.query(
          `UPDATE "VillageDeactivationRequest"
              SET status = 'CANCELLED', "cancelledByUserId" = $2,
                  "cancelledAt" = $3, "cancellationReason" = $4
            WHERE id = $1`,
          [requestId, adminId, cancelledAt, reason],
        );

      expect(await constraintOf(cancel(deadline))).toBe(
        "VillageDeactivationRequest_cancelled_shape_check",
      );
      expect(await constraintOf(cancel(new Date(deadline.getTime() + 1)))).toBe(
        "VillageDeactivationRequest_cancelled_shape_check",
      );
      expect(
        await constraintOf(cancel(new Date(deadline.getTime() - 1000), "  ")),
      ).toBe("VillageDeactivationRequest_cancelled_shape_check");

      await cancel(new Date(deadline.getTime() - 1000));
    });

    it("completes only at or after the deadline, with a recorded actor", async () => {
      const { requestId } = await newApproved();
      const complete = (completedAt: Date, actor: string | null) =>
        db.pool.query(
          `UPDATE "VillageDeactivationRequest"
              SET status = 'COMPLETED', "completedAt" = $2, "completedBy" = $3
            WHERE id = $1`,
          [requestId, completedAt, actor],
        );

      expect(
        await constraintOf(complete(new Date(deadline.getTime() - 1000), "SYSTEM:test")),
      ).toBe("VillageDeactivationRequest_completed_shape_check");
      expect(await constraintOf(complete(deadline, null))).toBe(
        "VillageDeactivationRequest_completed_shape_check",
      );

      await complete(deadline, "SYSTEM:test");
    });

    it("keeps one terminal outcome when cancel and complete race", async () => {
      const { requestId } = await newApproved();
      const results = await Promise.allSettled([
        db.pool.query(
          `UPDATE "VillageDeactivationRequest"
              SET status = 'CANCELLED', "cancelledByUserId" = $2,
                  "cancelledAt" = $3, "cancellationReason" = 'race'
            WHERE id = $1 AND status = 'APPROVED'`,
          [requestId, adminId, new Date(deadline.getTime() - 1000)],
        ),
        db.pool.query(
          `UPDATE "VillageDeactivationRequest"
              SET status = 'COMPLETED', "completedAt" = $2,
                  "completedBy" = 'SYSTEM:test'
            WHERE id = $1 AND status = 'APPROVED'`,
          [requestId, deadline],
        ),
      ]);
      const changed = results.map((r) =>
        r.status === "fulfilled" ? (r.value.rowCount ?? 0) : 0,
      );
      const { rows } = await db.pool.query<{ status: string }>(
        `SELECT status FROM "VillageDeactivationRequest" WHERE id = $1`,
        [requestId],
      );

      // The conditional WHERE status = 'APPROVED' lets only one write land.
      expect(changed[0] + changed[1]).toBe(1);
      expect(["CANCELLED", "COMPLETED"]).toContain(rows[0].status);
    });

    it("refuses a blank request reason and negative processingAttempts", async () => {
      const villageId = await newVillage();
      const id = uid("request");
      ids.requests.push(id);

      expect(
        await constraintOf(
          db.pool.query(
            `INSERT INTO "VillageDeactivationRequest"
               (id, "villageId", "requesterUserId", reason, "updatedAt")
             VALUES ($1, $2, $3, '   ', now())`,
            [id, villageId, adminId],
          ),
        ),
      ).toBe("VillageDeactivationRequest_reason_not_blank_check");
      expect(
        await constraintOf(
          db.pool.query(
            `INSERT INTO "VillageDeactivationRequest"
               (id, "villageId", "requesterUserId", reason, "processingAttempts", "updatedAt")
             VALUES ($1, $2, $3, 'r', -1, now())`,
            [id, villageId, adminId],
          ),
        ),
      ).toBe("VillageDeactivationRequest_processingAttempts_check");
    });

    it("stores a notification once per dedupeKey", async () => {
      const key = uid("dedupe");
      const insert = (id: string) => {
        ids.notifications.push(id);
        return db.pool.query(
          `INSERT INTO "Notification"(id, "userId", type, "dedupeKey")
           VALUES ($1, $2, 'DEACTIVATION_REQUESTED', $3)`,
          [id, adminId, key],
        );
      };

      await insert(uid("notification"));

      expect(await constraintOf(insert(uid("notification")))).toBe(
        "Notification_dedupeKey_key",
      );
    });

    it("refuses to delete a village that still has requests (RESTRICT)", async () => {
      const villageId = await newVillage();
      await newPending(villageId);

      expect(
        await constraintOf(
          db.pool.query(`DELETE FROM "Village" WHERE id = $1`, [villageId]),
        ),
      ).toBe("VillageDeactivationRequest_villageId_fkey");
    });

    it("agrees with the Prisma model (round trip through the client)", async () => {
      const villageId = await newVillage();
      const id = uid("request");
      ids.requests.push(id);

      await db.prisma.villageDeactivationRequest.create({
        data: {
          id,
          villageId,
          requesterUserId: adminId,
          reason: "Prisma round trip",
        },
      });
      const row = await db.prisma.villageDeactivationRequest.findUniqueOrThrow({
        where: { id },
      });

      expect(row.status).toBe("PENDING");
      expect(row.processingAttempts).toBe(0);
      expect(row.scheduledDeactivationAt).toBeNull();
    });
  },
);
