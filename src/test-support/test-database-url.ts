/*
 * Pure safety checks for the integration-test database URL. No imports, so it
 * can be unit tested directly.
 *
 * Integration tests write real rows, so they must never run against the
 * development database, and certainly not a production one. The URL is only
 * accepted when ALL of these hold:
 *   - TEST_DATABASE_URL is set and is a postgres:// or postgresql:// URL;
 *   - the database name clearly says it is a test database (a "test" or
 *     "tests" word, for example vfc_test);
 *   - it is not the same database as DATABASE_URL (localhost, 127.0.0.1 and
 *     ::1 count as the same host; a missing port means 5432);
 *   - the host is local, unless TEST_DATABASE_ALLOW_REMOTE=1 is set on purpose;
 *   - NODE_ENV is not "production".
 */

export type TestDatabaseProblem =
  | "MISSING"
  | "INVALID_URL"
  | "NOT_POSTGRES"
  | "NOT_A_TEST_DATABASE"
  | "SAME_AS_DATABASE_URL"
  | "REMOTE_HOST"
  | "PRODUCTION_ENVIRONMENT";

export interface TestDatabaseTarget {
  url: string;
  host: string;
  port: number;
  database: string;
}

export type TestDatabaseCheck =
  | { ok: true; target: TestDatabaseTarget }
  | { ok: false; problem: TestDatabaseProblem; message: string };

export type TestDatabaseEnv = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export interface ParsedDatabaseUrl {
  host: string;
  port: number;
  database: string;
}

export function parseDatabaseUrl(
  raw: string,
): ParsedDatabaseUrl | "INVALID_URL" | "NOT_POSTGRES" {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return "INVALID_URL";
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return "NOT_POSTGRES";
  }

  const rawHost = url.searchParams.get("host") ?? url.hostname;
  const host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
  const port = url.port ? Number(url.port) : 5432;
  let database: string;

  try {
    database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    return "INVALID_URL";
  }

  if (host.length === 0 || database.length === 0 || !Number.isInteger(port)) {
    return "INVALID_URL";
  }

  return { host, port, database };
}

export function isLocalHost(host: string): boolean {
  // A unix socket directory (host=/var/run/postgresql) is local too.
  return LOCAL_HOSTS.has(host) || host.startsWith("/");
}

function normalizedHost(host: string): string {
  return isLocalHost(host) ? "localhost" : host;
}

export function isSameDatabase(
  a: ParsedDatabaseUrl,
  b: ParsedDatabaseUrl,
): boolean {
  return (
    normalizedHost(a.host) === normalizedHost(b.host) &&
    a.port === b.port &&
    a.database === b.database
  );
}

/** True when the database name has a "test" or "tests" word in it. */
export function isTestDatabaseName(name: string): boolean {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((word) => word === "test" || word === "tests");
}

function fail(problem: TestDatabaseProblem, message: string): TestDatabaseCheck {
  return { ok: false, problem, message };
}

export function checkTestDatabaseEnv(env: TestDatabaseEnv): TestDatabaseCheck {
  const raw = env.TEST_DATABASE_URL?.trim();

  if (!raw) {
    return fail("MISSING", "TEST_DATABASE_URL is not set.");
  }

  if (env.NODE_ENV === "production") {
    return fail(
      "PRODUCTION_ENVIRONMENT",
      "Integration tests do not run when NODE_ENV is production.",
    );
  }

  const parsed = parseDatabaseUrl(raw);

  if (parsed === "INVALID_URL") {
    return fail("INVALID_URL", "TEST_DATABASE_URL is not a valid URL.");
  }

  if (parsed === "NOT_POSTGRES") {
    return fail(
      "NOT_POSTGRES",
      "TEST_DATABASE_URL must start with postgres:// or postgresql://.",
    );
  }

  if (!isTestDatabaseName(parsed.database)) {
    return fail(
      "NOT_A_TEST_DATABASE",
      `The database name "${parsed.database}" does not clearly identify a test database. Use a name with a "test" word in it, for example vfc_test.`,
    );
  }

  const devRaw = env.DATABASE_URL?.trim();

  if (devRaw) {
    const dev = parseDatabaseUrl(devRaw);

    if (typeof dev === "object" && isSameDatabase(parsed, dev)) {
      return fail(
        "SAME_AS_DATABASE_URL",
        "TEST_DATABASE_URL points at the same database as DATABASE_URL.",
      );
    }
  }

  if (!isLocalHost(parsed.host) && env.TEST_DATABASE_ALLOW_REMOTE !== "1") {
    return fail(
      "REMOTE_HOST",
      `The test database host "${parsed.host}" is not local. Set TEST_DATABASE_ALLOW_REMOTE=1 only if this is a disposable test server.`,
    );
  }

  return { ok: true, target: { url: raw, ...parsed } };
}
