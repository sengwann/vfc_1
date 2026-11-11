/** Creates/drops ONLY a uniquely named DB on an explicitly authorized test host.
 * Never runs unless both TEST_DATABASE_URL and VFC_ALLOW_MIGRATION_TESTS=1 exist.
 */
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { requireTestDatabaseTarget } from "@/test-support/test-database";

const migrationName = "20261107120000_fund_financial_integrity";
const root = path.join(process.cwd(), "prisma/migrations");
export async function disposable(
  run: (db: Client, url: string) => Promise<void>,
) {
  const target = requireTestDatabaseTarget();
  const url = new URL(target.url);
  const name = `vfc_test_${randomUUID().replaceAll("-", "")}`;
  url.pathname = "/postgres";
  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  let created = false;
  let db: Client | undefined;
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    url.pathname = `/${name}`;
    db = new Client({ connectionString: url.toString() });
    await db.connect();
    const identity = await db.query<{ name: string }>(
      "SELECT current_database() AS name",
    );
    if (identity.rows[0]?.name !== name)
      throw new Error("Wrong disposable database");
    for (const entry of (await readdir(root))
      .filter((n) => /^\d/.test(n) && n < migrationName)
      .sort()) {
      await db.query(
        await readFile(path.join(root, entry, "migration.sql"), "utf8"),
      );
    }
    await run(db, url.toString());
  } finally {
    await db?.query("ROLLBACK").catch(() => undefined);
    await db?.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}
export const migration = () =>
  readFile(path.join(root, migrationName, "migration.sql"), "utf8");
