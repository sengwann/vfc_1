/** Release-only adapter; Neon ownership remains in report-postgres-sandbox. */
import { trackReleaseLifecycle } from "./phase7-release-registry";
export { drainReleaseLifecycles } from "./phase7-release-registry";
import { Client } from "pg";
import { startReportPostgresSandbox } from "./report-postgres-sandbox";

export function requireReleaseOptIns(mode: "migrated" | "fresh", env = process.env) {
  if (env.VFC_RUN_PHASE7_RELEASE !== "1" || env.VFC_RUN_REPORT_POSTGRES_TESTS !== "1" ||
      env.TEST_DATABASE_ALLOW_REMOTE !== "1" || env.NODE_ENV === "production")
    throw new Error("Release, report and remote opt-ins in a non-production process are required");
  if (mode === "fresh" && env.VFC_ALLOW_MIGRATION_TESTS !== "1")
    throw new Error("Independent migration opt-in required");
}

// Uncancellable closes remain owned until settlement. A missed 10s budget is
// reported AFTER settlement; no losing Promise.race operation is abandoned.
async function closeWithin(work: Promise<unknown>, label: string) {
  const started=Date.now(); await work;
  if(Date.now()-started>10000)throw new Error(`${label} exceeded 10s budget; close completed late`);
}
export function withReleaseDatabase<T>(mode: "migrated" | "fresh", run: (db: Client, url: string) => Promise<T>): Promise<T> {
  return trackReleaseLifecycle(() => runReleaseDatabase(mode, run));
}
async function runReleaseDatabase<T>(mode: "migrated" | "fresh", run: (db: Client, url: string) => Promise<T>) {
  requireReleaseOptIns(mode);
  const lifecycleStarted=Date.now();
  const sandbox = await startReportPostgresSandbox();
  const failures: unknown[] = [];
  let result!: T;
  let client: Client | undefined;
  try {
    result = await sandbox.withConnection(async (verified) => {
      const url = mode === "fresh" ? await sandbox.createEmptyDatabase() : verified;
      const expected = new URL(url), base = new URL(verified);
      if (expected.hostname !== base.hostname || expected.username !== base.username ||
          expected.password !== base.password || expected.search !== base.search ||
          (mode === "fresh" && !/^\/vfc_test_[a-f0-9]{32}$/.test(expected.pathname)))
        throw new Error("Release child target mismatch");
      client = new Client({ connectionString: url });
      await client.connect();
      const identity = await client.query<{ database: string; role: string; application: string }>(
        "SELECT current_database() AS database,current_user AS role,current_setting('application_name') AS application");
      if (identity.rows[0]?.database !== expected.pathname.slice(1) || identity.rows[0]?.role !== decodeURIComponent(expected.username) ||
          identity.rows[0]?.application !== sandbox.applicationName)
        throw new Error("Release database handshake failed");
      return run(client, url);
    });
  } catch (error) { failures.push(error); }
  finally {
    if (client) {
      try { await closeWithin(client.query("ROLLBACK"), "SQL rollback"); } catch (error) { failures.push(error); }
      try { await closeWithin(client.end(), "SQL client"); } catch (error) { failures.push(error); }
    }
    try { await sandbox.dispose(); } catch (error) { failures.push(error); }
  }
  if(Date.now()-lifecycleStarted>300000)failures.push(new Error("Release fixture exceeded 300s accounting budget; all work awaited to settlement"));
  if (failures.length) throw new AggregateError(failures, "Release operation/cleanup failed; inspect sandbox ownership breadcrumb");
  return result;
}
