/** Lifecycle safety tests with mocked services. These prove no PostgreSQL behavior. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startReportPostgresSandbox } from "./report-postgres-sandbox";

const m = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  end: vi.fn(),
  query: vi.fn(),
}));
vi.mock("./test-database", async () => {
  const { checkTestDatabaseEnv } = await import("./test-database-url");
  return {
    openTestDatabase: m.open,
    requireTestDatabaseTarget: (env: Record<string, string | undefined>) => {
      const checked = checkTestDatabaseEnv(env);
      if (!checked.ok) throw new Error("Unsafe URL");
      return checked.target;
    },
  };
});

const project = "project-test",
  parent = "br-test-parent",
  child = "br-owned-child";
const endpoint = "ep-owned",
  host = "ep-owned.us-east-2.aws.neon.tech";
const password = "unit-password-do-not-log",
  apiKey = "unit-key-do-not-log";
let name: string, deleted: boolean, mismatchOwner: boolean;
let wrongProject: boolean, wrongParent: boolean, wrongEndpoint: boolean;
let loseCreateResponse: boolean, rejectDelete: boolean, wrongDatabase: boolean;
let calls: { method: string; route: string; body?: Record<string, unknown> }[];
let order: string[];
let ownershipOverride: Record<string, unknown>;
let parentDefault: unknown;
let parentPrimary: unknown;
let responseEndpointId: string;

function branch() {
  return {
    id: child,
    project_id: project,
    parent_id: parent,
    name: mismatchOwner ? "somebody-elses-branch" : name,
    default: false,
    primary: false,
    protected: false,
    current_state: "ready",
    created_at: "2026-01-01T00:00:00Z",
    ...ownershipOverride,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  for (const [key, value] of Object.entries({
    VFC_RUN_REPORT_POSTGRES_TESTS: "1",
    TEST_DATABASE_ALLOW_REMOTE: "1",
    NODE_ENV: "test",
    NEON_REPORT_API_KEY: apiKey,
    NEON_REPORT_PROJECT_ID: project,
    NEON_REPORT_PROJECT_NAME: "Dedicated test project",
    NEON_REPORT_PARENT_BRANCH_ID: parent,
    NEON_REPORT_PARENT_BRANCH_NAME: "Dedicated test branch",
    NEON_REPORT_DB_ROLE: "report_role",
    NEON_REPORT_DB_PASSWORD: password,
    DATABASE_URL: "postgresql://unused@localhost/app",
    TEST_DATABASE_URL: "postgresql://unused@parent.invalid/vfc_test",
  }))
    vi.stubEnv(key, value);
  name = "";
  deleted = false;
  mismatchOwner = false;
  wrongProject = false;
  wrongParent = false;
  wrongEndpoint = false;
  loseCreateResponse = false;
  rejectDelete = false;
  wrongDatabase = false;
  calls = [];
  order = [];
  ownershipOverride = {};
  parentDefault = false;
  parentPrimary = false;
  responseEndpointId = endpoint;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  m.close.mockImplementation(async () => {
    order.push("close");
  });
  m.end.mockImplementation(async () => {
    order.push("end");
  });
  m.open.mockImplementation(async (env: Record<string, string>) => {
    const url = new URL(env.TEST_DATABASE_URL);
    m.query.mockResolvedValue({
      rows: [
        {
          database: wrongDatabase ? "other_database" : "vfc_test",
          role: "report_role",
          application: url.searchParams.get("application_name"),
          ssl: true,
        },
      ],
    });
    return {
      databaseName: "vfc_test",
      prisma: {},
      close: m.close,
      pool: {
        query: m.query,
        connect: vi.fn(async () => ({
          query: m.query,
          release: vi.fn(),
          connection: {
            stream: {
              encrypted: true,
              authorized: true,
            },
          },
        })),
        end: m.end,
      },
    };
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      expect(url.startsWith("https://console.neon.tech/api/v2/projects/")).toBe(
        true,
      );
      expect(init.redirect).toBe("error");
      const route = url.slice("https://console.neon.tech/api/v2".length);
      const method = init.method ?? "GET";
      const body = init.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      calls.push({ method, route, body });
      order.push(`${method} ${route}`);
      const result = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), { status });
      const base = `/projects/${project}`;
      if (method === "POST" && route === `${base}/branches`) {
        name = (body?.branch as { name: string }).name;
        if (loseCreateResponse)
          throw new Error(`Untrusted transport error ${apiKey}`);
        return result({
          branch: branch(),
          endpoints: [{ id: responseEndpointId, host }],
        });
      }
      if (method === "DELETE") {
        expect(route).toBe(`${base}/branches/${child}`);
        if (rejectDelete) return result({}, 500);
        deleted = true;
        return result({});
      }
      if (route === base)
        return result({
          project: {
            id: project,
            name: wrongProject ? "Wrong project" : "Dedicated test project",
          },
        });
      if (route === `${base}/branches/${parent}`)
        return result({
          branch: {
            id: parent,
            project_id: project,
            name: wrongParent ? "Wrong parent" : "Dedicated test branch",
            default: parentDefault,
            primary: parentPrimary,
          },
        });
      if (route.endsWith("/databases"))
        return result({
          databases: [
            {
              name: "vfc_test",
              branch_id: route.includes(parent) ? parent : child,
            },
          ],
        });
      if (route === `${base}/branches/${child}/roles`)
        return result({ roles: [{ name: "report_role", branch_id: child }] });
      if (route === `${base}/branches/${child}`)
        return deleted ? result({}, 404) : result({ branch: branch() });
      if (route === `${base}/endpoints/${endpoint}`)
        return result({
          endpoint: {
            id: endpoint,
            project_id: project,
            branch_id: wrongEndpoint ? parent : child,
            type: "read_write",
            host,
            current_state: "active",
          },
        });
      throw new Error("Unexpected API route");
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Neon lifecycle safety (mocked services only)", () => {
  it("requires runtime opt-in before touching any service", async () => {
    vi.stubEnv("VFC_RUN_REPORT_POSTGRES_TESTS", "");
    await expect(startReportPostgresSandbox()).rejects.toThrow("opt-in");
    expect(fetch).not.toHaveBeenCalled();
    expect(m.open).not.toHaveBeenCalled();
  });
  it("requires explicit remote database opt-in", async () => {
    vi.stubEnv("TEST_DATABASE_ALLOW_REMOTE", "");
    await expect(startReportPostgresSandbox()).rejects.toThrow("opt-in");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["project", "parent"])(
    "rejects the wrong %s before branch creation or SQL",
    async (kind) => {
      wrongProject = kind === "project";
      wrongParent = kind === "parent";
      await expect(startReportPostgresSandbox()).rejects.toThrow("mismatch");
      expect(calls.every((call) => call.method === "GET")).toBe(true);
      expect(m.open).not.toHaveBeenCalled();
    },
  );
  it.each([true, undefined])(
    "refuses a default or unclassified parent (%s) before creating anything",
    async (value) => {
      parentDefault = value;
      await expect(startReportPostgresSandbox()).rejects.toThrow(
        "explicitly non-default",
      );
      expect(calls.every((call) => call.method === "GET")).toBe(true);
      expect(m.open).not.toHaveBeenCalled();
    },
  );
  it.each([true, null, "false", 0, {}, []])(
    "rejects unsafe primary metadata on the parent (%j)",
    async (value) => {
      parentPrimary = value;
      await expect(startReportPostgresSandbox()).rejects.toThrow(
        "explicitly non-default",
      );
      expect(calls.every((call) => call.method === "GET")).toBe(true);
      expect(m.open).not.toHaveBeenCalled();
    },
  );
  it.each([false, undefined])(
    "accepts safe or omitted primary metadata on the parent (%s)",
    async (value) => {
      parentPrimary = value;
      const sandbox = await startReportPostgresSandbox();
      expect(m.open).toHaveBeenCalledTimes(1);
      await sandbox.dispose();
      expect(deleted).toBe(true);
    },
  );
  it.each([false, undefined])(
    "accepts safe or omitted primary metadata on the owned child (%s)",
    async (value) => {
      ownershipOverride = { primary: value };
      const sandbox = await startReportPostgresSandbox();
      expect(m.open).toHaveBeenCalledTimes(1);
      await sandbox.dispose();
      expect(deleted).toBe(true);
    },
  );
  it("rejects primary:true on a newly created child before SQL and refuses unverified deletion", async () => {
    ownershipOverride = { primary: true };
    await expect(startReportPostgresSandbox()).rejects.toThrow(
      "Setup/cleanup failed",
    );
    expect(m.open).not.toHaveBeenCalled();
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
  });
  it.each([
    ["NEON_REPORT_PROJECT_ID", "Project-test"],
    ["NEON_REPORT_PROJECT_ID", "project_test"],
    ["NEON_REPORT_PROJECT_ID", "a".repeat(61)],
    ["NEON_REPORT_PARENT_BRANCH_ID", "BR-test"],
    ["NEON_REPORT_PARENT_BRANCH_ID", "br_test"],
    ["NEON_REPORT_PARENT_BRANCH_ID", "ep-wrong-kind"],
    ["NEON_REPORT_PARENT_BRANCH_ID", "br-"],
    ["NEON_REPORT_PARENT_BRANCH_ID", `br-${"a".repeat(58)}`],
  ])(
    "rejects invalid configured resource ID %s=%s before any API request",
    async (key, value) => {
      vi.stubEnv(key, value);
      await expect(startReportPostgresSandbox()).rejects.toThrow("ID");
      expect(fetch).not.toHaveBeenCalled();
      expect(m.open).not.toHaveBeenCalled();
    },
  );
  it.each([
    "BR-child",
    "br_child",
    "ep-wrong-kind",
    "br-",
    `br-${"a".repeat(58)}`,
  ])(
    "refuses to use or delete an invalid branch ID returned by creation: %s",
    async (value) => {
      ownershipOverride = { id: value };
      await expect(startReportPostgresSandbox()).rejects.toThrow(
        "Setup/cleanup failed",
      );
      expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
      expect(m.open).not.toHaveBeenCalled();
    },
  );
  it.each([
    "EP-owned",
    "ep_owned",
    "br-wrong-kind",
    "ep-",
    `ep-${"a".repeat(58)}`,
  ])(
    "rejects an invalid endpoint ID and disposes only the valid owned child: %s",
    async (value) => {
      responseEndpointId = value;
      await expect(startReportPostgresSandbox()).rejects.toThrow(
        "Invalid Neon endpoint ID",
      );
      expect(m.open).not.toHaveBeenCalled();
      expect(deleted).toBe(true);
    },
  );
  it("binds the SQL URL to the newly attested direct child endpoint", async () => {
    const sandbox = await startReportPostgresSandbox();
    const creation = calls.find((call) => call.method === "POST")!;
    expect(creation.body).toEqual({
      branch: { parent_id: parent, name, protected: false },
      endpoints: [{ type: "read_write" }],
    });
    expect(name).toMatch(/^vfc-report-[a-f0-9-]+$/);
    const env = m.open.mock.calls[0][0] as Record<string, string>;
    const url = new URL(env.TEST_DATABASE_URL);
    expect(url.hostname).toBe(host);
    expect(url.pathname).toBe("/vfc_test");
    expect(url.searchParams.get("sslmode")).toBe("verify-full");
    expect(url.searchParams.get("application_name")).toBe(
      sandbox.applicationName,
    );
    expect(url.username).toBe("report_role");
    expect(url.password).toBe(password);
    expect(m.open.mock.calls[0][1]).toEqual({
      max: 3,
      connectionTimeoutMillis: 10_000,
    });
    await sandbox.dispose();
    const removeIndex = order.indexOf(
      `DELETE /projects/${project}/branches/${child}`,
    );
    expect(order.indexOf("close")).toBeLessThan(order.indexOf("end"));
    expect(order.indexOf("end")).toBeLessThan(removeIndex);
    expect(order[removeIndex - 1]).toBe(
      `GET /projects/${project}/branches/${child}`,
    );
    expect(deleted).toBe(true);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
      password,
    );
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
      apiKey,
    );
  });
  it("refuses SQL when endpoint metadata points at the parent", async () => {
    wrongEndpoint = true;
    await expect(startReportPostgresSandbox()).rejects.toThrow(
      "endpoint mismatch",
    );
    expect(m.open).not.toHaveBeenCalled();
    expect(deleted).toBe(true);
  });
  it("refuses to delete a branch whose ownership no longer matches", async () => {
    const sandbox = await startReportPostgresSandbox();
    mismatchOwner = true;
    await expect(sandbox.dispose()).rejects.toThrow(`branch=${child}`);
    expect(calls.filter((call) => call.method === "DELETE")).toEqual([]);
    expect(m.close).toHaveBeenCalled();
    expect(m.end).toHaveBeenCalled();
  });
  it.each([
    { id: parent },
    { project_id: "other-project" },
    { parent_id: "other-parent" },
    { created_at: "changed" },
    { default: true },
    { default: undefined },
    { primary: true },
    { primary: null },
    { primary: "false" },
    { primary: 0 },
    { protected: true },
  ])(
    "refuses deletion after ownership metadata changes: %j",
    async (override) => {
      const sandbox = await startReportPostgresSandbox();
      ownershipOverride = override;
      await expect(sandbox.dispose()).rejects.toThrow(`branch=${child}`);
      expect(calls.filter((call) => call.method === "DELETE")).toEqual([]);
    },
  );
  it("rejects a wrong SQL database identity and disposes the owned child", async () => {
    wrongDatabase = true;
    await expect(startReportPostgresSandbox()).rejects.toThrow(
      "identity mismatch",
    );
    expect(deleted).toBe(true);
    expect(m.end).toHaveBeenCalled();
  });
  it("does not assume child credentials work or change a parent password on login failure", async () => {
    m.open.mockRejectedValueOnce(
      new Error(`Authentication failed: ${password}`),
    );
    const error = await startReportPostgresSandbox().catch(
      (failure: unknown) => failure,
    );
    expect((error as Error).message).toBe(
      "Could not open the validated disposable branch database",
    );
    expect((error as Error).message).not.toContain(password);
    expect(deleted).toBe(true);
    expect(
      calls
        .filter((call) => call.method !== "GET")
        .map((call) => [call.method, call.route]),
    ).toEqual([
      ["POST", `/projects/${project}/branches`],
      ["DELETE", `/projects/${project}/branches/${child}`],
    ]);
  });
  it("attempts both connection closes and branch removal despite close failures", async () => {
    const sandbox = await startReportPostgresSandbox();
    m.close.mockRejectedValueOnce(new Error(`untrusted ${password}`));
    m.end.mockRejectedValueOnce(new Error(`untrusted ${apiKey}`));
    const error = await sandbox.dispose().catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(2);
    expect(
      JSON.stringify(
        (error as AggregateError).errors.map((e: Error) => e.message),
      ),
    ).not.toContain(password);
    expect(deleted).toBe(true);
    expect(m.end).toHaveBeenCalled();
  });
  it("reports both pending closes as unconfirmed and still verifies ownership before removal", async () => {
    const sandbox = await startReportPostgresSandbox();
    vi.useFakeTimers();
    let finishPrisma!: () => void, finishPool!: () => void;
    let prismaFinished = false,
      poolFinished = false;
    m.close.mockImplementationOnce(async () => {
      order.push("close-start");
      await new Promise<void>((resolve) => {
        finishPrisma = resolve;
      });
      prismaFinished = true;
    });
    m.end.mockImplementationOnce(async () => {
      order.push("end-start");
      await new Promise<void>((resolve) => {
        finishPool = resolve;
      });
      poolFinished = true;
    });
    const pending = sandbox.dispose().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(m.end).toHaveBeenCalled();
    expect(deleted).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await pending;
    expect(error).toBeInstanceOf(AggregateError);
    expect(
      (error as AggregateError).errors.map((failure: Error) => failure.message),
    ).toEqual([
      "Prisma close timed out; operation not cancelled and completion unconfirmed",
      "PostgreSQL pool close timed out; operation not cancelled and completion unconfirmed",
    ]);
    expect(prismaFinished).toBe(false);
    expect(poolFinished).toBe(false);
    expect(deleted).toBe(true);
    expect((error as Error).message).toContain("branch=removed");
    const removal = order.indexOf(
      `DELETE /projects/${project}/branches/${child}`,
    );
    expect(order[removal - 1]).toBe(
      `GET /projects/${project}/branches/${child}`,
    );
    expect(order.indexOf("end-start")).toBeLessThan(removal);
    // Settle the underlying work only now; the timeout never cancelled it.
    finishPrisma();
    finishPool();
    await Promise.resolve();
    expect(prismaFinished).toBe(true);
    expect(poolFinished).toBe(true);
  });
  it("reports a remaining child explicitly when deletion fails", async () => {
    const sandbox = await startReportPostgresSandbox();
    rejectDelete = true;
    await expect(sandbox.dispose()).rejects.toThrow(`branch=${child}`);
    expect(deleted).toBe(false);
  });
  it("does not retry creation or guess a deletion target after a lost POST response", async () => {
    loseCreateResponse = true;
    const error = await startReportPostgresSandbox().catch(
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as Error).message).toContain(`name=${name}`);
    expect((error as Error).message).not.toContain(apiKey);
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(calls.filter((call) => call.method === "DELETE")).toHaveLength(0);
    expect(m.open).not.toHaveBeenCalled();
  });
});
