import { describe, expect, it } from "vitest";

import {
  checkTestDatabaseEnv,
  isSameDatabase,
  isTestDatabaseName,
  parseDatabaseUrl,
} from "./test-database-url";

const DEV = "postgresql://dev:pw@localhost:5432/vfc";
const TEST = "postgresql://tester:pw@localhost:5432/vfc_test";

function problem(env: Record<string, string | undefined>): string | null {
  const result = checkTestDatabaseEnv(env);
  return result.ok ? null : result.problem;
}

describe("isTestDatabaseName", () => {
  it("accepts names with a test word", () => {
    for (const name of ["vfc_test", "vfc-test", "test_vfc", "TEST", "vfc_tests", "a.test.b"]) {
      expect(isTestDatabaseName(name)).toBe(true);
    }
  });

  it("refuses names that only contain the letters", () => {
    for (const name of ["vfc", "latest", "contest", "protest_db", "testing", "vfctest", "prod"]) {
      expect(isTestDatabaseName(name)).toBe(false);
    }
  });
});

describe("parseDatabaseUrl", () => {
  it("reads host, port (default 5432) and database", () => {
    expect(parseDatabaseUrl("postgres://u:p@Example.com/vfc_test")).toEqual({
      host: "example.com",
      port: 5432,
      database: "vfc_test",
    });
    expect(parseDatabaseUrl("postgresql://u@[::1]:6543/x_test?sslmode=require")).toEqual({
      host: "::1",
      port: 6543,
      database: "x_test",
    });
  });

  it("refuses non-postgres and malformed URLs", () => {
    expect(parseDatabaseUrl("mysql://u@localhost/x")).toBe("NOT_POSTGRES");
    expect(parseDatabaseUrl("not a url")).toBe("INVALID_URL");
    expect(parseDatabaseUrl("postgresql://u@localhost/")).toBe("INVALID_URL");
  });
});

describe("isSameDatabase", () => {
  const a = { host: "localhost", port: 5432, database: "vfc" };

  it("treats localhost, 127.0.0.1 and ::1 as one host", () => {
    for (const host of ["127.0.0.1", "::1", "localhost"]) {
      expect(isSameDatabase(a, { ...a, host })).toBe(true);
    }
  });

  it("differs by port, database or remote host", () => {
    expect(isSameDatabase(a, { ...a, port: 5433 })).toBe(false);
    expect(isSameDatabase(a, { ...a, database: "vfc_test" })).toBe(false);
    expect(isSameDatabase(a, { ...a, host: "db.example.com" })).toBe(false);
  });
});

describe("checkTestDatabaseEnv", () => {
  it("accepts a distinct local test database", () => {
    const result = checkTestDatabaseEnv({ TEST_DATABASE_URL: TEST, DATABASE_URL: DEV });
    expect(result.ok).toBe(true);
  });

  it("accepts it when DATABASE_URL is not set", () => {
    expect(problem({ TEST_DATABASE_URL: TEST })).toBeNull();
  });

  it("fails safely when TEST_DATABASE_URL is missing or blank", () => {
    expect(problem({ DATABASE_URL: DEV })).toBe("MISSING");
    expect(problem({ TEST_DATABASE_URL: "  ", DATABASE_URL: DEV })).toBe("MISSING");
  });

  it("refuses the same database as DATABASE_URL, however it is spelled", () => {
    const sameTest = "postgresql://u:p@localhost:5432/vfc_test";
    expect(
      problem({ TEST_DATABASE_URL: sameTest, DATABASE_URL: "postgresql://x:y@127.0.0.1/vfc_test" }),
    ).toBe("SAME_AS_DATABASE_URL");
    expect(problem({ TEST_DATABASE_URL: sameTest, DATABASE_URL: sameTest })).toBe(
      "SAME_AS_DATABASE_URL",
    );
  });

  it("refuses a name that does not say test, even when it differs", () => {
    expect(
      problem({ TEST_DATABASE_URL: "postgresql://u@localhost:5432/vfc_scratch", DATABASE_URL: DEV }),
    ).toBe("NOT_A_TEST_DATABASE");
    expect(problem({ TEST_DATABASE_URL: DEV })).toBe("NOT_A_TEST_DATABASE");
  });

  it("refuses a remote host unless explicitly allowed", () => {
    const remote = "postgresql://u:p@db.example.com:5432/vfc_test";
    expect(problem({ TEST_DATABASE_URL: remote, DATABASE_URL: DEV })).toBe("REMOTE_HOST");
    expect(
      problem({ TEST_DATABASE_URL: remote, DATABASE_URL: DEV, TEST_DATABASE_ALLOW_REMOTE: "1" }),
    ).toBeNull();
  });

  it("refuses to run in production", () => {
    expect(problem({ TEST_DATABASE_URL: TEST, NODE_ENV: "production" })).toBe(
      "PRODUCTION_ENVIRONMENT",
    );
  });

  it("refuses malformed or non-postgres URLs", () => {
    expect(problem({ TEST_DATABASE_URL: "nonsense" })).toBe("INVALID_URL");
    expect(problem({ TEST_DATABASE_URL: "mysql://u@localhost/x_test" })).toBe("NOT_POSTGRES");
  });
});
