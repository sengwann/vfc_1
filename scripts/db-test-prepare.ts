/*
 * Prepares the disposable integration-test database: creates it if it does not
 * exist, then applies the committed migrations with `prisma migrate deploy`.
 *
 * Run: npm run db:test:prepare
 *
 * Safety:
 *   - The target comes only from TEST_DATABASE_URL and must pass
 *     checkTestDatabaseEnv (a "test" database name, not DATABASE_URL, local
 *     host). Anything else exits before connecting.
 *   - It uses `migrate deploy`, which only applies pending migrations. It never
 *     runs `migrate dev`, `db push`, `migrate reset` or any DROP/TRUNCATE.
 *   - DATABASE_URL is overridden to the test URL for the child process only, so
 *     the development database is not touched even if prisma.config.ts reads it.
 */

import "dotenv/config";

import { spawnSync } from "node:child_process";
import { Client } from "pg";

import { checkTestDatabaseEnv } from "../src/test-support/test-database-url";

async function ensureDatabaseExists(url: string, database: string) {
  const probe = new Client({ connectionString: url });

  try {
    await probe.connect();
    await probe.end();
    return;
  } catch (error) {
    await probe.end().catch(() => undefined);

    // 3D000 = invalid_catalog_name: the database does not exist yet.
    if ((error as { code?: string }).code !== "3D000") {
      throw error;
    }
  }

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new Client({ connectionString: admin.toString() });

  await client.connect();

  try {
    // Identifier is validated by checkTestDatabaseEnv; quote it defensively.
    await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
    console.log(`Created test database "${database}".`);
  } finally {
    await client.end();
  }
}

async function main() {
  const check = checkTestDatabaseEnv(process.env);

  if (!check.ok) {
    console.error(`Refusing to prepare the test database: ${check.message}`);
    process.exit(1);
  }

  const { url, database, host, port } = check.target;

  console.log(`Preparing test database "${database}" on ${host}:${port}.`);

  await ensureDatabaseExists(url, database);

  const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  console.log("Test database is ready. Run: npm run test:integration");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
