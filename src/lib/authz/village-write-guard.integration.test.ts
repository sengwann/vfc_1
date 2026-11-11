/*
 * The village mutation guard against a real, disposable PostgreSQL database.
 * Skipped unless TEST_DATABASE_URL is set; see src/test-support/test-database.ts
 * and docs/village-deactivation-design-notes.md for how to run it.
 *
 * Covers what mocks cannot: the two-statement guard under real locking. In
 * particular, a mutation that started before an approval must not commit after
 * read-only began. Every row has a unique id and only those rows are deleted.
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isSerializationConflict } from "@/lib/db/retry";
import {
  TrackedIds,
  openTestDatabase,
  type TestDatabase,
} from "@/test-support/test-database";

import { guardVillageWrite } from "./village";

const HOUR = 60 * 60 * 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "guardVillageWrite (real database)",
  () => {
    let db: TestDatabase;
    const ids = new TrackedIds();
    let adminId: string;

    const uid = (label: string) => `itest-${label}-${randomUUID()}`;

    async function newVillage(status = "ACTIVE"): Promise<string> {
      const id = uid("village");
      ids.villages.push(id);
      await db.pool.query(
        `INSERT INTO "Village"(id, "villageCode", name, status, "updatedAt")
         VALUES ($1, $2, 'Guard test village', $3::"VillageStatus", now())`,
        [id, `IT-${randomUUID()}`, status],
      );
      return id;
    }

    async function newPending(villageId: string): Promise<string> {
      const id = uid("request");
      ids.requests.push(id);
      await db.pool.query(
        `INSERT INTO "VillageDeactivationRequest"
           (id, "villageId", "requesterUserId", reason, "updatedAt")
         VALUES ($1, $2, $3, 'guard test', now())`,
        [id, villageId, adminId],
      );
      return id;
    }

    /**
     * Approve the way the real approval will: bump the village row (takes its
     * lock and changes its row version), then move the request to APPROVED.
     * `client` is a pg client already inside BEGIN, so a test can hold the
     * lock open before committing.
     */
    async function approveIn(
      client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
      villageId: string,
      requestId: string,
    ) {
      const approvedAt = new Date();
      approvedAt.setMilliseconds(0);
      const scheduled = new Date(approvedAt.getTime() + 24 * HOUR);

      await client.query(
        `UPDATE "Village" SET "updatedAt" = now() WHERE id = $1`,
        [villageId],
      );
      await client.query(
        `UPDATE "VillageDeactivationRequest"
            SET status = 'APPROVED', "approvedByUserId" = $2,
                "approvedAt" = $3, "scheduledDeactivationAt" = $4
          WHERE id = $1`,
        [requestId, adminId, approvedAt, scheduled],
      );
    }

    async function approve(villageId: string, requestId: string) {
      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        await approveIn(client, villageId, requestId);
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    }

    const guard = (villageId: string) =>
      db.prisma.$transaction((tx) => guardVillageWrite(tx, villageId));

    beforeAll(async () => {
      db = await openTestDatabase();
      adminId = uid("admin");
      ids.users.push(adminId);
      await db.pool.query(
        `INSERT INTO "User"(id, name, "passwordHash", role, "updatedAt")
         VALUES ($1, 'Guard admin', 'x', 'SYSTEM_ADMIN', now())`,
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

    it("allows writes on an ACTIVE village with no request", async () => {
      expect(await guard(await newVillage())).toEqual({ ok: true });
    });

    it("a PENDING request restricts nothing", async () => {
      const villageId = await newVillage();
      await newPending(villageId);

      expect(await guard(villageId)).toEqual({ ok: true });
    });

    it("an APPROVED request makes the village read-only, without changing its lifecycle status", async () => {
      const villageId = await newVillage();
      await approve(villageId, await newPending(villageId));

      expect(await guard(villageId)).toEqual({
        ok: false,
        reason: "VILLAGE_READ_ONLY",
      });

      const { rows } = await db.pool.query<{ status: string }>(
        `SELECT status::text AS status FROM "Village" WHERE id = $1`,
        [villageId],
      );
      expect(rows[0].status).toBe("ACTIVE");
    });

    it("reads resume when the request leaves APPROVED (cancelled)", async () => {
      const villageId = await newVillage();
      const requestId = await newPending(villageId);
      await approve(villageId, requestId);

      await db.pool.query(
        `UPDATE "VillageDeactivationRequest"
            SET status = 'CANCELLED', "cancelledByUserId" = $2,
                "cancelledAt" = now() AT TIME ZONE 'UTC',
                "cancellationReason" = 'guard test'
          WHERE id = $1`,
        [requestId, adminId],
      );

      expect(await guard(villageId)).toEqual({ ok: true });
    });

    it("reports a SUSPENDED, DEACTIVATED or missing village as inactive", async () => {
      for (const status of ["SUSPENDED", "DEACTIVATED"]) {
        expect(await guard(await newVillage(status))).toEqual({
          ok: false,
          reason: "VILLAGE_INACTIVE",
        });
      }

      expect(await guard(uid("missing"))).toEqual({
        ok: false,
        reason: "VILLAGE_INACTIVE",
      });
    });

    it("a mutation that waits behind an in-flight approval sees read-only once it commits", async () => {
      const villageId = await newVillage();
      const requestId = await newPending(villageId);

      const approver = await db.pool.connect();

      try {
        await approver.query("BEGIN");
        await approveIn(approver, villageId, requestId);

        // READ COMMITTED mutation starts while the approval holds the lock.
        const mutation = guard(villageId);
        await sleep(300);
        await approver.query("COMMIT");

        expect(await mutation).toEqual({
          ok: false,
          reason: "VILLAGE_READ_ONLY",
        });
      } finally {
        approver.release();
      }
    });

    it("a Serializable mutation that started before the approval cannot commit after it", async () => {
      const villageId = await newVillage();
      const requestId = await newPending(villageId);

      let error: unknown;

      try {
        await db.prisma.$transaction(
          async (tx) => {
            // The snapshot is taken by this first statement.
            await tx.$queryRaw`SELECT 1`;

            // The approval commits after that snapshot.
            await approve(villageId, requestId);

            await guardVillageWrite(tx, villageId);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (caught) {
        error = caught;
      }

      // 40001: the whole mutation is retried by withSerializableRetry and then
      // sees read-only. It must never fall through as a successful commit.
      expect(error).toBeDefined();
      expect(isSerializationConflict(error)).toBe(true);
    });

    it("an approval waits for an in-flight guarded mutation, so the mutation finishes first", async () => {
      const villageId = await newVillage();
      const requestId = await newPending(villageId);
      const order: string[] = [];

      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered!: () => void;
      const inside = new Promise<void>((resolve) => {
        entered = resolve;
      });

      const mutation = db.prisma.$transaction(async (tx) => {
        const result = await guardVillageWrite(tx, villageId);
        entered();
        await held;
        order.push("mutation-commit");
        return result;
      });

      await inside;

      const approval = approve(villageId, requestId).then(() => {
        order.push("approval-commit");
      });

      await sleep(300);
      release();

      expect(await mutation).toEqual({ ok: true });
      await approval;
      expect(order).toEqual(["mutation-commit", "approval-commit"]);
    });
  },
);
