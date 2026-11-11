/*
 * The deactivation transitions against a real, disposable PostgreSQL database.
 * Skipped unless TEST_DATABASE_URL is set; see src/test-support/test-database.ts
 * and docs/village-deactivation-design-notes.md. Every row has a unique id and
 * only those rows are deleted (audit rows are append-only and stay).
 *
 * Covers what the fake-client unit tests cannot: real locking, Serializable
 * retries and the database constraints working together with the transitions.
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
  approveDeactivationRequestInTx,
  cancelDeactivationRequestInTx,
  completeDeactivationRequestInTx,
  rejectDeactivationRequestInTx,
  submitDeactivationRequestInTx,
} from "./deactivation-transitions";

const HOUR = 60 * 60 * 1000;
const SERIALIZABLE = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const;

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "deactivation transitions (real database)",
  () => {
    let db: TestDatabase;
    const ids = new TrackedIds();
    let adminId: string;

    const uid = (label: string) => `itest-${label}-${randomUUID()}`;
    const run = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
      withSerializableRetry(() => db.prisma.$transaction(fn, SERIALIZABLE));

    async function newVillage(): Promise<{ villageId: string; chiefId: string }> {
      const villageId = uid("village");
      const chiefId = uid("chief");
      ids.villages.push(villageId);
      ids.users.push(chiefId);
      await db.pool.query(
        `INSERT INTO "Village"(id, "villageCode", name, "updatedAt")
         VALUES ($1, $2, 'Transition test village', now())`,
        [villageId, `IT-${randomUUID()}`],
      );
      await db.pool.query(
        `INSERT INTO "User"(id, "villageId", name, "passwordHash", role, "membershipStatus", "updatedAt")
         VALUES ($1, $2, 'Test chief', 'x', 'CHIEF', 'ACTIVE', now())`,
        [chiefId, villageId],
      );
      return { villageId, chiefId };
    }

    async function submit(villageId: string, chiefId: string): Promise<string> {
      const out = await run((tx) =>
        submitDeactivationRequestInTx(tx, { actorUserId: chiefId, villageId, reason: "integration" }),
      );
      if (out.kind !== "created") throw new Error(`submit failed: ${out.kind}`);
      ids.requests.push(out.requestId);
      return out.requestId;
    }

    const approve = (requestId: string, now?: Date) =>
      run((tx) => approveDeactivationRequestInTx(tx, { requestId, actorUserId: adminId, now }));

    const villageStatus = async (villageId: string) =>
      (await db.pool.query<{ status: string }>(`SELECT status::text FROM "Village" WHERE id = $1`, [villageId])).rows[0].status;

    const requestStatus = async (requestId: string) =>
      (await db.pool.query<{ status: string }>(`SELECT status::text FROM "VillageDeactivationRequest" WHERE id = $1`, [requestId])).rows[0].status;

    beforeAll(async () => {
      db = await openTestDatabase();
      adminId = uid("admin");
      ids.users.push(adminId);
      await db.pool.query(
        `INSERT INTO "User"(id, name, "passwordHash", role, "updatedAt")
         VALUES ($1, 'Transition admin', 'x', 'SYSTEM_ADMIN', now())`,
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

    it("submit, approve: a 24h deadline is stored and the village stays ACTIVE", async () => {
      const { villageId, chiefId } = await newVillage();
      const requestId = await submit(villageId, chiefId);
      const out = await approve(requestId);

      expect(out.kind).toBe("approved");
      if (out.kind === "approved") {
        expect(out.scheduledDeactivationAt.getTime() - out.approvedAt.getTime()).toBe(24 * HOUR);
      }
      expect(await requestStatus(requestId)).toBe("APPROVED");
      expect(await villageStatus(villageId)).toBe("ACTIVE");
    });

    it("two concurrent approvals produce exactly one approval", async () => {
      const { villageId, chiefId } = await newVillage();
      const requestId = await submit(villageId, chiefId);
      const results = await Promise.all([approve(requestId), approve(requestId)]);

      expect(results.filter((r) => r.kind === "approved")).toHaveLength(1);
      expect(results.filter((r) => r.kind === "blocked")).toHaveLength(1);
    });

    it("an approve racing a reject leaves one consistent decision", async () => {
      const { villageId, chiefId } = await newVillage();
      const requestId = await submit(villageId, chiefId);
      const [a, r] = await Promise.all([
        approve(requestId),
        run((tx) => rejectDeactivationRequestInTx(tx, { requestId, actorUserId: adminId, reason: "race", cooldownMs: HOUR })),
      ]);

      expect([a.kind === "approved", r.kind === "rejected"].filter(Boolean)).toHaveLength(1);
      expect(["APPROVED", "REJECTED"]).toContain(await requestStatus(requestId));
    });

    it("cooldown after a rejection is enforced by the database clock", async () => {
      const { villageId, chiefId } = await newVillage();
      const requestId = await submit(villageId, chiefId);
      await run((tx) => rejectDeactivationRequestInTx(tx, { requestId, actorUserId: adminId, reason: "no", cooldownMs: HOUR }));

      const again = await run((tx) =>
        submitDeactivationRequestInTx(tx, { actorUserId: chiefId, villageId, reason: "again" }),
      );
      expect(again).toMatchObject({ kind: "blocked", reason: "COOLDOWN_ACTIVE" });
    });

    it("cancel before the deadline resumes normal operation without touching the lifecycle status", async () => {
      const { villageId, chiefId } = await newVillage();
      const requestId = await submit(villageId, chiefId);
      await approve(requestId);

      const out = await run((tx) =>
        cancelDeactivationRequestInTx(tx, { requestId, actorUserId: chiefId, villageId, reason: "changed mind" }),
      );

      expect(out.kind).toBe("cancelled");
      expect(await requestStatus(requestId)).toBe("CANCELLED");
      expect(await villageStatus(villageId)).toBe("ACTIVE");
    });

    it("a due request completes: village DEACTIVATED, request COMPLETED, with the stored deadline", async () => {
      const { villageId, chiefId } = await newVillage();
      const requestId = await submit(villageId, chiefId);
      // Approved 25 hours ago, so the 24h deadline has passed.
      await approve(requestId, new Date(Date.now() - 25 * HOUR));

      const out = await run((tx) => completeDeactivationRequestInTx(tx, { requestId }));

      expect(out.kind).toBe("completed");
      expect(await requestStatus(requestId)).toBe("COMPLETED");
      expect(await villageStatus(villageId)).toBe("DEACTIVATED");
    });

    it("a request that is not due yet is not completed", async () => {
      const { villageId, chiefId } = await newVillage();
      const requestId = await submit(villageId, chiefId);
      await approve(requestId);

      expect(await run((tx) => completeDeactivationRequestInTx(tx, { requestId }))).toEqual({
        kind: "blocked",
        reason: "NOT_DUE",
      });
      expect(await villageStatus(villageId)).toBe("ACTIVE");
    });

    it("two concurrent completions (worker overlap) complete it once", async () => {
      const { villageId, chiefId } = await newVillage();
      const requestId = await submit(villageId, chiefId);
      await approve(requestId, new Date(Date.now() - 25 * HOUR));

      const results = await Promise.all([
        run((tx) => completeDeactivationRequestInTx(tx, { requestId })),
        run((tx) => completeDeactivationRequestInTx(tx, { requestId })),
      ]);

      expect(results.filter((r) => r.kind === "completed")).toHaveLength(1);
      expect(await villageStatus(villageId)).toBe("DEACTIVATED");
    });

    it("after the deadline, cancel is refused even though the worker has not run", async () => {
      const { villageId, chiefId } = await newVillage();
      const requestId = await submit(villageId, chiefId);
      await approve(requestId, new Date(Date.now() - 25 * HOUR));

      const out = await run((tx) =>
        cancelDeactivationRequestInTx(tx, { requestId, actorUserId: chiefId, villageId, reason: "too late" }),
      );

      expect(out).toEqual({ kind: "blocked", reason: "DEADLINE_REACHED" });
      expect(await requestStatus(requestId)).toBe("APPROVED");
    });

    it("cancel and complete racing after the deadline leave one terminal outcome", async () => {
      const { villageId, chiefId } = await newVillage();
      const requestId = await submit(villageId, chiefId);
      await approve(requestId, new Date(Date.now() - 25 * HOUR));

      await Promise.all([
        run((tx) => cancelDeactivationRequestInTx(tx, { requestId, actorUserId: chiefId, villageId, reason: "race" })),
        run((tx) => completeDeactivationRequestInTx(tx, { requestId })),
      ]);

      // Past the deadline only completion can win.
      expect(await requestStatus(requestId)).toBe("COMPLETED");
      expect(await villageStatus(villageId)).toBe("DEACTIVATED");
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
