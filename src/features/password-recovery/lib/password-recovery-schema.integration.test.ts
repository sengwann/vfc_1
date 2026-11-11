/*
 * Schema-level tests for password recovery against a real, disposable
 * PostgreSQL database (see src/test-support/test-database.ts).
 *
 * Skipped unless TEST_DATABASE_URL is set, so the normal `npm test` run does
 * not need a database. Run with `npm run test:integration` after
 * `npm run db:test:prepare`.
 *
 * This covers what only the database can enforce: the one-active-request-per-
 * user partial unique index, the per-status CHECK constraints (hash format,
 * hash cleared once the code is dead, no completion after expiry, note length),
 * the notification link-family CHECK, and the RESTRICT foreign keys.
 *
 * It does NOT test state transitions (for example PENDING -> COMPLETED). A
 * CHECK cannot see the previous row, so transitions are enforced by the
 * application with compare-and-set updates and tested with the service
 * (Phase 2 onwards).
 *
 * Nothing is truncated or reset: every row has a unique id and only those ids
 * are deleted afterwards.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  TrackedIds,
  openTestDatabase,
  type TestDatabase,
} from "@/test-support/test-database";

const HOUR = 60 * 60 * 1000;

/** A well-formed code hash: 64 lowercase hex characters. */
const HASH = "a".repeat(64);

type TimeColumn =
  | "createdAt"
  | "requestExpiresAt"
  | "codeIssuedAt"
  | "codeExpiresAt"
  | "rejectedAt"
  | "revokedAt"
  | "expiredAt"
  | "completedAt";

interface RequestSpec {
  status?: string;
  /**
   * Hours from now (negative = in the past) for each time column. The database
   * computes them in UTC, like the migration's own notes say to.
   */
  hours?: Partial<Record<TimeColumn, number>>;
  /** Plain values, bound as parameters. */
  values?: Record<string, string | number | null>;
}

const NOW_UTC = "(now() AT TIME ZONE 'UTC')";

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "password recovery schema (real database)",
  () => {
    let db: TestDatabase;
    const ids = new TrackedIds();
    let adminId: string;
    let villageId: string;

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

    async function newUser(
      role: "SYSTEM_ADMIN" | "VILLAGER",
      inVillage: string | null,
    ): Promise<string> {
      const id = uid(role.toLowerCase());
      ids.users.push(id);
      await db.pool.query(
        `INSERT INTO "User"(id, "villageId", name, "passwordHash", role, "updatedAt")
         VALUES ($1, $2, 'Integration user', 'x', $3, now())`,
        [id, inVillage, role],
      );
      return id;
    }

    /** Inserts a request for `userId`; the id is tracked for cleanup. */
    async function insertRequest(
      userId: string,
      spec: RequestSpec = {},
    ): Promise<string> {
      const id = uid("recovery");
      ids.recoveryRequests.push(id);

      const columns = ['"id"', '"userId"', '"updatedAt"'];
      const placeholders = ["$1", "$2", NOW_UTC];
      const params: Array<string | number | null> = [id, userId];

      const add = (column: string, expression: (n: number) => string, value: string | number | null) => {
        params.push(value);
        columns.push(`"${column}"`);
        placeholders.push(expression(params.length));
      };

      if (spec.status !== undefined) {
        add("status", (n) => `$${n}`, spec.status);
      }

      const hours: Partial<Record<TimeColumn, number>> = {
        requestExpiresAt: 7 * 24,
        ...spec.hours,
      };
      for (const [column, offset] of Object.entries(hours)) {
        add(
          column,
          (n) => `(${NOW_UTC} + make_interval(secs => $${n}::float8))`,
          (offset as number) * 3600,
        );
      }

      for (const [column, value] of Object.entries(spec.values ?? {})) {
        add(column, (n) => `$${n}`, value);
      }

      await db.pool.query(
        `INSERT INTO "PasswordRecoveryRequest"(${columns.join(", ")})
         VALUES (${placeholders.join(", ")})`,
        params,
      );
      return id;
    }

    /** A request whose code is currently live. */
    function issued(extra: RequestSpec = {}): RequestSpec {
      return {
        status: "CODE_ISSUED",
        hours: { codeIssuedAt: -1, codeExpiresAt: 71, ...extra.hours },
        values: {
          codeHash: HASH,
          codeIssuedByUserId: adminId,
          issueCount: 1,
          ...extra.values,
        },
      };
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

    const freshUser = () => newUser("VILLAGER", villageId);

    beforeAll(async () => {
      db = await openTestDatabase();
      adminId = await newUser("SYSTEM_ADMIN", null);
      villageId = await newVillage();
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

    describe("one active request per user", () => {
      it("blocks a second PENDING or CODE_ISSUED request for the same user", async () => {
        const userId = await freshUser();
        const first = await insertRequest(userId);

        expect(await constraintOf(insertRequest(userId))).toBe(
          "PasswordRecoveryRequest_userId_active_key",
        );

        await db.pool.query(
          `UPDATE "PasswordRecoveryRequest"
              SET status = 'CODE_ISSUED', "codeHash" = $2,
                  "codeIssuedAt" = ${NOW_UTC},
                  "codeExpiresAt" = ${NOW_UTC} + interval '72 hours',
                  "codeIssuedByUserId" = $3, "issueCount" = 1
            WHERE id = $1`,
          [first, HASH, adminId],
        );

        expect(await constraintOf(insertRequest(userId))).toBe(
          "PasswordRecoveryRequest_userId_active_key",
        );
      });

      it("lets two concurrent requests for one user create exactly one", async () => {
        const userId = await freshUser();
        const results = await Promise.allSettled([
          insertRequest(userId),
          insertRequest(userId),
          insertRequest(userId),
        ]);

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);
      });

      it("lets different users each have their own active request", async () => {
        await insertRequest(await freshUser());
        await insertRequest(await freshUser());
      });

      it("lets a user file again once the old request is terminal", async () => {
        const userId = await freshUser();
        await insertRequest(userId, {
          status: "REJECTED",
          hours: { rejectedAt: -1 },
          values: { rejectedByUserId: adminId },
        });
        await insertRequest(userId, {
          status: "EXPIRED",
          hours: { requestExpiresAt: -24, createdAt: -8 * 24, expiredAt: 0 },
        });
        await insertRequest(userId);
      });

      it("allows a SYSTEM_ADMIN target with no village", async () => {
        const otherAdmin = await newUser("SYSTEM_ADMIN", null);
        await insertRequest(otherAdmin);
      });
    });

    describe("PENDING and CODE_ISSUED shape", () => {
      it("keeps a code hash out of a PENDING request", async () => {
        expect(
          await constraintOf(
            insertRequest(await freshUser(), { values: { codeHash: HASH } }),
          ),
        ).toBe("PasswordRecoveryRequest_pending_shape_check");
      });

      it("requires a hash on CODE_ISSUED (NULL must not slip past the CHECK)", async () => {
        expect(
          await constraintOf(
            insertRequest(await freshUser(), {
              ...issued(),
              values: {
                codeHash: null,
                codeIssuedByUserId: adminId,
                issueCount: 1,
              },
            }),
          ),
        ).toBe("PasswordRecoveryRequest_code_issued_shape_check");
      });

      it("refuses anything that is not a 64-character lowercase hex hash", async () => {
        for (const bad of ["ABCD-EFGH-JKMN-PQRS", "A".repeat(64), "a".repeat(63)]) {
          expect(
            await constraintOf(
              insertRequest(
                await freshUser(),
                issued({ values: { codeHash: bad } }),
              ),
            ),
          ).toBe("PasswordRecoveryRequest_code_hash_format_check");
        }
      });

      it("requires the code to expire after it was issued", async () => {
        expect(
          await constraintOf(
            insertRequest(
              await freshUser(),
              issued({ hours: { codeIssuedAt: 0, codeExpiresAt: 0 } }),
            ),
          ),
        ).toBe("PasswordRecoveryRequest_code_fields_check");
      });

      it("refuses an issuer without an issue time", async () => {
        expect(
          await constraintOf(
            insertRequest(await freshUser(), {
              values: { codeIssuedByUserId: adminId },
            }),
          ),
        ).toBe("PasswordRecoveryRequest_code_fields_check");
      });

      it("requires the request to expire after it was created", async () => {
        expect(
          await constraintOf(
            insertRequest(await freshUser(), {
              hours: { requestExpiresAt: -24, createdAt: 0 },
            }),
          ),
        ).toBe("PasswordRecoveryRequest_request_expiry_check");
      });

      it("refuses negative counters", async () => {
        expect(
          await constraintOf(
            insertRequest(await freshUser(), {
              values: { failedRedeemAttempts: -1 },
            }),
          ),
        ).toBe("PasswordRecoveryRequest_counters_check");
      });
    });

    describe("COMPLETED", () => {
      const completedHours = {
        codeIssuedAt: -2,
        codeExpiresAt: 1,
        completedAt: 0,
      };
      // A function: adminId is only set in beforeAll, after this file is loaded.
      const completedValues = () => ({
        codeIssuedByUserId: adminId,
        issueCount: 1,
      });

      it("accepts a completion inside the code's lifetime with the hash cleared", async () => {
        await insertRequest(await freshUser(), {
          status: "COMPLETED",
          hours: completedHours,
          values: completedValues(),
        });
      });

      it("requires the hash to be cleared", async () => {
        expect(
          await constraintOf(
            insertRequest(await freshUser(), {
              status: "COMPLETED",
              hours: completedHours,
              values: { ...completedValues(), codeHash: HASH },
            }),
          ),
        ).toBe("PasswordRecoveryRequest_completed_shape_check");
      });

      it("refuses a completion after the code expired", async () => {
        expect(
          await constraintOf(
            insertRequest(await freshUser(), {
              status: "COMPLETED",
              hours: { codeIssuedAt: -5, codeExpiresAt: -1, completedAt: 0 },
              values: completedValues(),
            }),
          ),
        ).toBe("PasswordRecoveryRequest_completed_shape_check");
      });

      it("refuses a completion when no code was ever issued", async () => {
        expect(
          await constraintOf(
            insertRequest(await freshUser(), {
              status: "COMPLETED",
              hours: { completedAt: 0 },
            }),
          ),
        ).toBe("PasswordRecoveryRequest_completed_shape_check");
      });
    });

    describe("REJECTED and notes", () => {
      const rejected = (extra: RequestSpec = {}): RequestSpec => ({
        status: "REJECTED",
        hours: { rejectedAt: 0, ...extra.hours },
        values: { rejectedByUserId: adminId, ...extra.values },
      });

      it("accepts a rejection with a note of exactly 200 characters", async () => {
        await insertRequest(
          await freshUser(),
          rejected({ values: { rejectionNote: "x".repeat(200) } }),
        );
      });

      it("refuses a note longer than 200 characters or a blank one", async () => {
        for (const note of ["x".repeat(201), "   "]) {
          expect(
            await constraintOf(
              insertRequest(
                await freshUser(),
                rejected({ values: { rejectionNote: note } }),
              ),
            ),
          ).toBe("PasswordRecoveryRequest_notes_check");
        }
      });

      it("requires who and when for a rejection", async () => {
        expect(
          await constraintOf(
            insertRequest(await freshUser(), { status: "REJECTED" }),
          ),
        ).toBe("PasswordRecoveryRequest_rejected_shape_check");
      });

      it("refuses to reject a request that already had a code", async () => {
        expect(
          await constraintOf(
            insertRequest(
              await freshUser(),
              rejected({
                hours: { codeIssuedAt: -1, codeExpiresAt: 1 },
                values: { codeIssuedByUserId: adminId, issueCount: 1 },
              }),
            ),
          ),
        ).toBe("PasswordRecoveryRequest_rejected_shape_check");
      });

      it("keeps a rejection note off a request that was not rejected", async () => {
        expect(
          await constraintOf(
            insertRequest(await freshUser(), {
              values: { rejectionNote: "hello" },
            }),
          ),
        ).toBe("PasswordRecoveryRequest_pending_shape_check");
      });
    });

    describe("EXPIRED", () => {
      it("accepts expiry of a PENDING request after its expiry time", async () => {
        await insertRequest(await freshUser(), {
          status: "EXPIRED",
          hours: { requestExpiresAt: -24, createdAt: -8 * 24, expiredAt: 0 },
        });
      });

      it("accepts expiry of an issued code, keeping history but no hash", async () => {
        await insertRequest(await freshUser(), {
          status: "EXPIRED",
          hours: { codeIssuedAt: -5, codeExpiresAt: -1, expiredAt: 0 },
          values: { codeIssuedByUserId: adminId, issueCount: 1 },
        });
      });

      it("refuses expiry before it was due", async () => {
        expect(
          await constraintOf(
            insertRequest(await freshUser(), {
              status: "EXPIRED",
              hours: { expiredAt: 0 },
            }),
          ),
        ).toBe("PasswordRecoveryRequest_expired_shape_check");
      });

      it("requires the hash to be cleared on expiry", async () => {
        expect(
          await constraintOf(
            insertRequest(await freshUser(), {
              status: "EXPIRED",
              hours: { codeIssuedAt: -5, codeExpiresAt: -1, expiredAt: 0 },
              values: {
                codeIssuedByUserId: adminId,
                issueCount: 1,
                codeHash: HASH,
              },
            }),
          ),
        ).toBe("PasswordRecoveryRequest_expired_shape_check");
      });
    });

    describe("REVOKED", () => {
      const withdrawn = (extra: RequestSpec = {}): RequestSpec => ({
        status: "REVOKED",
        hours: { codeIssuedAt: -1, codeExpiresAt: 1, revokedAt: 0 },
        values: {
          codeIssuedByUserId: adminId,
          issueCount: 1,
          revocationReason: "WITHDRAWN",
          revokedByUserId: adminId,
          revocationNote: "Wrong person",
          ...extra.values,
        },
      });

      it("accepts a withdrawal by a named authority with a note", async () => {
        await insertRequest(await freshUser(), withdrawn());
      });

      it("requires a revoker and a note for a withdrawal", async () => {
        for (const missing of ["revokedByUserId", "revocationNote"]) {
          expect(
            await constraintOf(
              insertRequest(
                await freshUser(),
                withdrawn({ values: { [missing]: null } }),
              ),
            ),
          ).toBe("PasswordRecoveryRequest_revoked_shape_check");
        }
      });

      it("only allows a withdrawal once a code was issued", async () => {
        expect(
          await constraintOf(
            insertRequest(await freshUser(), {
              status: "REVOKED",
              hours: { revokedAt: 0 },
              values: {
                revocationReason: "WITHDRAWN",
                revokedByUserId: adminId,
                revocationNote: "n",
              },
            }),
          ),
        ).toBe("PasswordRecoveryRequest_revoked_shape_check");
      });

      it("keeps system revocations free of a user and a note", async () => {
        const attempt = async (values: Record<string, string | number | null>) =>
          constraintOf(
            insertRequest(await freshUser(), {
              status: "REVOKED",
              hours: { codeIssuedAt: -1, codeExpiresAt: 1, revokedAt: 0 },
              values: {
                codeIssuedByUserId: adminId,
                issueCount: 1,
                failedRedeemAttempts: 5,
                revocationReason: "TOO_MANY_ATTEMPTS",
                ...values,
              },
            }),
          );

        expect(await attempt({})).toBe("NO_ERROR");
        expect(await attempt({ revokedByUserId: adminId })).toBe(
          "PasswordRecoveryRequest_revoked_shape_check",
        );
        expect(await attempt({ revocationNote: "note" })).toBe(
          "PasswordRecoveryRequest_revoked_shape_check",
        );
        expect(await attempt({ failedRedeemAttempts: 0 })).toBe(
          "PasswordRecoveryRequest_revoked_shape_check",
        );
      });

      it("accepts TARGET_INELIGIBLE straight from PENDING", async () => {
        await insertRequest(await freshUser(), {
          status: "REVOKED",
          hours: { revokedAt: 0 },
          values: { revocationReason: "TARGET_INELIGIBLE" },
        });
      });

      it("refuses an unknown or missing reason", async () => {
        expect(
          await constraintOf(
            insertRequest(await freshUser(), {
              status: "REVOKED",
              hours: { revokedAt: 0 },
              values: { revocationReason: "BECAUSE" },
            }),
          ),
        ).toBe("PasswordRecoveryRequest_revocation_reason_check");

        expect(
          await constraintOf(
            insertRequest(await freshUser(), {
              status: "REVOKED",
              hours: { revokedAt: 0 },
            }),
          ),
        ).toBe("PasswordRecoveryRequest_revoked_shape_check");
      });
    });

    describe("notification link family", () => {
      async function notify(
        userId: string,
        type: string,
        links: { requestId?: string; recoveryRequestId?: string },
        dedupeKey = uid("dedupe"),
      ) {
        const id = uid("notification");
        ids.notifications.push(id);
        return db.pool.query(
          `INSERT INTO "Notification"(id, "userId", type, "requestId", "recoveryRequestId", "dedupeKey")
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, userId, type, links.requestId ?? null, links.recoveryRequestId ?? null, dedupeKey],
        );
      }

      async function newDeactivationRequest(): Promise<string> {
        const village = await newVillage();
        const id = uid("deactivation");
        ids.requests.push(id);
        await db.pool.query(
          `INSERT INTO "VillageDeactivationRequest"(id, "villageId", "requesterUserId", reason, "updatedAt")
           VALUES ($1, $2, $3, 'integration test', now())`,
          [id, village, adminId],
        );
        return id;
      }

      it("accepts a RECOVERY_* notification linked to a recovery request", async () => {
        const userId = await freshUser();
        const recoveryRequestId = await insertRequest(userId);
        await notify(userId, "RECOVERY_REQUESTED", { recoveryRequestId });
      });

      it("refuses a RECOVERY_* notification with no link, the deactivation link, or both", async () => {
        const userId = await freshUser();
        const recoveryRequestId = await insertRequest(userId);
        const requestId = await newDeactivationRequest();

        for (const links of [
          {},
          { requestId },
          { requestId, recoveryRequestId },
        ]) {
          expect(
            await constraintOf(notify(userId, "RECOVERY_REJECTED", links)),
          ).toBe("Notification_link_family_check");
        }
      });

      it("refuses a deactivation notification that uses the recovery link", async () => {
        const userId = await freshUser();
        const recoveryRequestId = await insertRequest(userId);

        expect(
          await constraintOf(
            notify(userId, "DEACTIVATION_REQUESTED", { recoveryRequestId }),
          ),
        ).toBe("Notification_link_family_check");
      });

      it("keeps deactivation notifications working, with or without their link", async () => {
        const userId = await freshUser();
        const requestId = await newDeactivationRequest();

        await notify(userId, "DEACTIVATION_REQUESTED", { requestId });
        await notify(userId, "DEACTIVATION_REMINDER", {});
      });

      it("keeps dedupeKey unique across both families", async () => {
        const userId = await freshUser();
        const recoveryRequestId = await insertRequest(userId);
        const key = uid("shared-dedupe");

        await notify(userId, "RECOVERY_REQUESTED", { recoveryRequestId }, key);

        expect(
          await constraintOf(
            notify(userId, "RECOVERY_RESET_COMPLETED", { recoveryRequestId }, key),
          ),
        ).toBe("Notification_dedupeKey_key");
      });
    });

    describe("RESTRICT foreign keys", () => {
      it("refuses to delete a user who has a recovery request", async () => {
        const userId = await freshUser();
        await insertRequest(userId);

        expect(
          await constraintOf(
            db.pool.query(`DELETE FROM "User" WHERE id = $1`, [userId]),
          ),
        ).toBe("PasswordRecoveryRequest_userId_fkey");
      });

      it("refuses to delete a village that has recovery requests", async () => {
        // A village of its own with no users, so no earlier foreign key fires.
        const lonelyVillage = await newVillage();
        await insertRequest(await freshUser(), {
          values: { villageId: lonelyVillage },
        });

        expect(
          await constraintOf(
            db.pool.query(`DELETE FROM "Village" WHERE id = $1`, [lonelyVillage]),
          ),
        ).toBe("PasswordRecoveryRequest_villageId_fkey");
      });

      it("refuses to delete a request that still has notifications", async () => {
        const userId = await freshUser();
        const recoveryRequestId = await insertRequest(userId);
        const notificationId = uid("notification");
        ids.notifications.push(notificationId);
        await db.pool.query(
          `INSERT INTO "Notification"(id, "userId", type, "recoveryRequestId", "dedupeKey")
           VALUES ($1, $2, 'RECOVERY_REQUESTED', $3, $4)`,
          [notificationId, userId, recoveryRequestId, uid("dedupe")],
        );

        expect(
          await constraintOf(
            db.pool.query(
              `DELETE FROM "PasswordRecoveryRequest" WHERE id = $1`,
              [recoveryRequestId],
            ),
          ),
        ).toBe("Notification_recoveryRequestId_fkey");
      });

      it("refuses to delete the user who issued, rejected or revoked a request", async () => {
        const issuer = await newUser("SYSTEM_ADMIN", null);
        const rejecter = await newUser("SYSTEM_ADMIN", null);
        const revoker = await newUser("SYSTEM_ADMIN", null);

        await insertRequest(await freshUser(), {
          status: "COMPLETED",
          hours: { codeIssuedAt: -2, codeExpiresAt: 1, completedAt: 0 },
          values: { codeIssuedByUserId: issuer, issueCount: 1 },
        });
        await insertRequest(await freshUser(), {
          status: "REJECTED",
          hours: { rejectedAt: 0 },
          values: { rejectedByUserId: rejecter },
        });
        await insertRequest(await freshUser(), {
          status: "REVOKED",
          hours: { codeIssuedAt: -1, codeExpiresAt: 1, revokedAt: 0 },
          values: {
            codeIssuedByUserId: adminId,
            issueCount: 1,
            revocationReason: "WITHDRAWN",
            revokedByUserId: revoker,
            revocationNote: "n",
          },
        });

        const remove = (id: string) =>
          constraintOf(db.pool.query(`DELETE FROM "User" WHERE id = $1`, [id]));

        expect(await remove(issuer)).toBe(
          "PasswordRecoveryRequest_codeIssuedByUserId_fkey",
        );
        expect(await remove(rejecter)).toBe(
          "PasswordRecoveryRequest_rejectedByUserId_fkey",
        );
        expect(await remove(revoker)).toBe(
          "PasswordRecoveryRequest_revokedByUserId_fkey",
        );
      });
    });

    it("agrees with the Prisma model (round trip through the client)", async () => {
      const userId = await freshUser();
      const id = uid("recovery");
      ids.recoveryRequests.push(id);

      await db.prisma.passwordRecoveryRequest.create({
        data: {
          id,
          userId,
          villageId,
          requestExpiresAt: new Date(Date.now() + 7 * 24 * HOUR),
        },
      });
      const row = await db.prisma.passwordRecoveryRequest.findUniqueOrThrow({
        where: { id },
      });

      expect(row.status).toBe("PENDING");
      expect(row.issueCount).toBe(0);
      expect(row.failedRedeemAttempts).toBe(0);
      expect(row.codeHash).toBeNull();
      expect(row.completedAt).toBeNull();
    });
  },
);
