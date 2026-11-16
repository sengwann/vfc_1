/** Fresh baseline inside a verified owned Neon child; cleanup is branch-only. */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Client } from "pg";
import { withReleaseDatabase } from "@/test-support/phase7-release-sandbox";

const migrationName = "20261107120000_fund_financial_integrity";
const root = path.join(process.cwd(), "prisma/migrations");
export async function disposable(
  run: (db: Client, url: string) => Promise<void>,
) {
  return withReleaseDatabase("fresh", async (db, url) => {
    for (const entry of (await readdir(root))
      .filter((n) => /^\d/.test(n) && n < migrationName).sort()) {
      await db.query(await readFile(path.join(root, entry, "migration.sql"), "utf8"));
    }
    await run(db, url);
  });
}
export const migration = () =>
  readFile(path.join(root, migrationName, "migration.sql"), "utf8");
