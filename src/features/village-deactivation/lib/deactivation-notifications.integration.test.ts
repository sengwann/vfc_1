/*
 * Notification delivery against a real, disposable PostgreSQL database.
 * Skipped unless TEST_DATABASE_URL is set (see src/test-support/test-database.ts).
 * Unique ids; only the rows this file creates are deleted.
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
  deliverDeactivationNotifications,
  markNotificationsRead,
  syncDeactivationNotifications,
} from "./deactivation-notifications";
import {
  approveDeactivationRequestInTx,
  submitDeactivationRequestInTx,
} from "./deactivation-transitions";

const HOUR = 60 * 60 * 1000;
const SERIALIZABLE = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const;

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "deactivation notifications (real database)",
  () => {
    let db: TestDatabase;
    const ids = new TrackedIds();
    let adminId: string;
    const uid = (label: string) => `itest-${label}-${randomUUID()}`;
    const run = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      withSerializableRetry(() => db.prisma.$transaction(fn, SERIALIZABLE));

    const notificationsOf = async (requestId: string) => {
      const rows = (
        await db.pool.query<{ id: string; userId: string; type: string }>(
          `SELECT id, "userId", type::text FROM "Notification" WHERE "requestId" = $1`,
          [requestId],
        )
      ).rows;
      // Remember them so cleanup deletes exactly what this test created.
      for (const row of rows) {
        if (!ids.notifications.includes(row.id)) ids.notifications.push(row.id);
      }
      return rows;
    };

    beforeAll(async () => {
      db = await openTestDatabase();
      adminId = uid("admin");
      ids.users.push(adminId);
      await db.pool.query(
        `INSERT INTO "User"(id, name, "passwordHash", role, "updatedAt")
         VALUES ($1, 'Notification admin', 'x', 'SYSTEM_ADMIN', now())`,
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

    async function newRequest() {
      const villageId = uid("village");
      const chiefId = uid("chief");
      ids.villages.push(villageId);
      ids.users.push(chiefId);
      await db.pool.query(
        `INSERT INTO "Village"(id, "villageCode", name, "updatedAt")
         VALUES ($1, $2, 'Notification test village', now())`,
        [villageId, `IT-${randomUUID()}`],
      );
      await db.pool.query(
        `INSERT INTO "User"(id, "villageId", name, "passwordHash", role, "membershipStatus", "updatedAt")
         VALUES ($1, $2, 'Test chief', 'x', 'CHIEF', 'ACTIVE', now())`,
        [chiefId, villageId],
      );
      const out = await run((tx) =>
        submitDeactivationRequestInTx(tx, { actorUserId: chiefId, villageId, reason: "integration" }),
      );
      if (out.kind !== "created") throw new Error(`submit failed: ${out.kind}`);
      ids.requests.push(out.requestId);
      return { requestId: out.requestId, chiefId };
    }

    const params = (requestId: string) => ({
      requestId,
      now: new Date(),
      reminderOffsetsMs: [12 * HOUR, 1 * HOUR],
    });

    it("stores each notification once, however often delivery runs", async () => {
      const { requestId } = await newRequest();

      await syncDeactivationNotifications(db.prisma, params(requestId));
      const afterFirst = await notificationsOf(requestId);
      await syncDeactivationNotifications(db.prisma, params(requestId));
      const afterSecond = await notificationsOf(requestId);

      expect(afterFirst.some((row) => row.userId === adminId && row.type === "DEACTIVATION_REQUESTED")).toBe(true);
      expect(afterSecond).toHaveLength(afterFirst.length);
    });

    it("concurrent deliveries do not create duplicates", async () => {
      const { requestId } = await newRequest();

      await Promise.all([
        syncDeactivationNotifications(db.prisma, params(requestId)),
        syncDeactivationNotifications(db.prisma, params(requestId)),
        syncDeactivationNotifications(db.prisma, params(requestId)),
      ]);
      const rows = await notificationsOf(requestId);
      const keys = rows.map((row) => `${row.userId}:${row.type}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("approval notifies the Chief, and delivery never alters request or village state", async () => {
      const { requestId, chiefId } = await newRequest();
      const approved = await run((tx) =>
        approveDeactivationRequestInTx(tx, { requestId, actorUserId: adminId }),
      );
      expect(approved.kind).toBe("approved");

      const before = await db.pool.query(
        `SELECT status::text, "updatedAt" FROM "VillageDeactivationRequest" WHERE id = $1`,
        [requestId],
      );
      await deliverDeactivationNotifications(db.prisma, requestId, "approved", {
        reminderOffsetsMs: [12 * HOUR, 1 * HOUR],
      });
      const after = await db.pool.query(
        `SELECT status::text, "updatedAt" FROM "VillageDeactivationRequest" WHERE id = $1`,
        [requestId],
      );

      expect(after.rows).toEqual(before.rows);
      const rows = await notificationsOf(requestId);
      expect(rows.some((row) => row.userId === chiefId && row.type === "DEACTIVATION_APPROVED")).toBe(true);
    });

    it("marking read only touches the owner's notifications", async () => {
      const { requestId, chiefId } = await newRequest();
      await syncDeactivationNotifications(db.prisma, params(requestId));
      const rows = await notificationsOf(requestId);
      const adminRow = rows.find((row) => row.userId === adminId);
      if (!adminRow) throw new Error("expected an admin notification");

      // The Chief tries to mark the admin's notification read: nothing changes.
      expect(await markNotificationsRead(db.prisma, chiefId, [adminRow.id], new Date())).toBe(0);
      expect(await markNotificationsRead(db.prisma, adminId, [adminRow.id], new Date())).toBe(1);
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
