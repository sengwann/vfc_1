/*
 * Connects integration tests to the disposable test database, or refuses.
 *
 * Every connection goes through checkTestDatabaseEnv (see
 * test-database-url.ts). After connecting, the server is asked which database
 * it actually opened and the answer must match the validated name, so a pooler
 * or URL trick cannot redirect the tests elsewhere.
 *
 * This file never truncates tables and never resets the database. Tests create
 * rows with unique ids and delete only those ids (see trackedIds).
 */

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

import {
  checkTestDatabaseEnv,
  type TestDatabaseTarget,
} from "./test-database-url";

export class UnsafeTestDatabaseError extends Error {
  constructor(message: string) {
    super(`Refusing to use the test database: ${message}`);
    this.name = "UnsafeTestDatabaseError";
  }
}

/** Validated target, or a thrown UnsafeTestDatabaseError. */
export function requireTestDatabaseTarget(
  env: Record<string, string | undefined> = process.env,
): TestDatabaseTarget {
  const check = checkTestDatabaseEnv(env);

  if (!check.ok) {
    throw new UnsafeTestDatabaseError(check.message);
  }

  return check.target;
}

export interface TestDatabase {
  pool: Pool;
  prisma: PrismaClient;
  databaseName: string;
  close: () => Promise<void>;
}

/** Tables the workflows need; a missing one means "not migrated". */
const REQUIRED_TABLES = [
  "VillageDeactivationRequest",
  "PasswordRecoveryRequest",
  "Notification",
];

export async function openTestDatabase(
  env: Record<string, string | undefined> = process.env,
): Promise<TestDatabase> {
  const target = requireTestDatabaseTarget(env);
  const pool = new Pool({ connectionString: target.url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const close = async () => {
    await prisma.$disconnect();
  };

  try {
    const { rows } = await pool.query<{ db: string }>(
      "SELECT current_database() AS db",
    );
    const actual = rows[0]?.db;

    if (actual !== target.database) {
      throw new UnsafeTestDatabaseError(
        `connected to "${actual}" but expected "${target.database}".`,
      );
    }

    for (const table of REQUIRED_TABLES) {
      const found = await pool.query<{ found: string | null }>(
        "SELECT to_regclass($1) AS found",
        [`public."${table}"`],
      );

      if (!found.rows[0]?.found) {
        throw new Error(
          `The test database is missing the "${table}" table. Run "npm run db:test:prepare" first.`,
        );
      }
    }
  } catch (error) {
    await close();
    throw error;
  }

  return { pool, prisma, databaseName: target.database, close };
}

/**
 * Records the ids a test run creates so cleanup deletes exactly those rows and
 * nothing else. Delete order matters because every foreign key is RESTRICT:
 * notifications, requests (deactivation, then password recovery), users,
 * villages.
 */
export class TrackedIds {
  readonly notifications: string[] = [];
  readonly requests: string[] = [];
  readonly recoveryRequests: string[] = [];
  readonly users: string[] = [];
  readonly villages: string[] = [];

  async cleanup(pool: Pool): Promise<void> {
    await pool.query(`DELETE FROM "Notification" WHERE id = ANY($1)`, [
      this.notifications,
    ]);
    await pool.query(
      `DELETE FROM "VillageDeactivationRequest" WHERE id = ANY($1)`,
      [this.requests],
    );
    await pool.query(
      `DELETE FROM "PasswordRecoveryRequest" WHERE id = ANY($1)`,
      [this.recoveryRequests],
    );
    await pool.query(`DELETE FROM "User" WHERE id = ANY($1)`, [this.users]);
    await pool.query(`DELETE FROM "Village" WHERE id = ANY($1)`, [
      this.villages,
    ]);
  }
}
