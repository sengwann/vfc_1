/** Disposable Neon child of an explicitly configured TEST parent branch.
 * Never connects to the parent, applies migrations, or deletes SQL history.
 * Account API and PostgreSQL are contacted only after explicit runtime opt-in.
 */
import { randomUUID } from "node:crypto";
import type { TestDatabase } from "./test-database";

type Json = Record<string, unknown>;
class SandboxError extends Error {}
function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SandboxError("Invalid Neon API object");
  return value as Json;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value)
    throw new SandboxError("Missing Neon metadata field");
  return value;
}
function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() !== value)
    throw new SandboxError(`Missing or invalid ${name}`);
  return value;
}
function resourceId(
  value: unknown,
  kind: "project" | "branch" | "endpoint",
): string {
  const result = text(value);
  // Neon API alphabet/length, plus the documented branch/endpoint prefixes.
  if (
    !/^[a-z0-9-]{1,60}$/.test(result) ||
    (kind === "branch" && !/^br-[a-z0-9-]+$/.test(result)) ||
    (kind === "endpoint" && !/^ep-[a-z0-9-]+$/.test(result))
  ) {
    throw new SandboxError(`Invalid Neon ${kind} ID`);
  }
  return result;
}
function nonPrimary(value: unknown): boolean {
  // Neon may omit this deprecated field. If supplied, only false is safe.
  return value === undefined || value === false;
}
class ApiFailure extends SandboxError {
  constructor(readonly status: number) {
    super(`Neon API returned HTTP ${status}`);
  }
}
class CloseDeadlineError extends SandboxError {}
// This bounds waiting only. It does NOT cancel the underlying close promise;
// Promise.race keeps a rejection handler attached if that operation settles late.
async function bounded<T>(work: Promise<T>, phase: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new CloseDeadlineError(
                `${phase} timed out; operation not cancelled and completion unconfirmed`,
              ),
            ),
          10_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function startReportPostgresSandbox(): Promise<{
  db: TestDatabase;
  dispose: () => Promise<void>;
  applicationName: string;
}> {
  if (
    process.env.VFC_RUN_REPORT_POSTGRES_TESTS !== "1" ||
    process.env.NODE_ENV === "production" ||
    process.env.TEST_DATABASE_ALLOW_REMOTE !== "1"
  ) {
    throw new SandboxError(
      "Report test opt-in, remote-test opt-in and a non-production process are required",
    );
  }
  const key = required("NEON_REPORT_API_KEY");
  const projectId = resourceId(required("NEON_REPORT_PROJECT_ID"), "project");
  const projectName = required("NEON_REPORT_PROJECT_NAME");
  const parentId = resourceId(
    required("NEON_REPORT_PARENT_BRANCH_ID"),
    "branch",
  );
  const parentName = required("NEON_REPORT_PARENT_BRANCH_NAME");
  const role = required("NEON_REPORT_DB_ROLE");
  const password = required("NEON_REPORT_DB_PASSWORD");
  const runName = `vfc-report-${randomUUID()}`;
  const prefix = `/projects/${projectId}`;
  let branchId: string | undefined;
  let createdAt: string | undefined;
  let endpointId: string | undefined;
  let endpointHost: string | undefined;
  let attemptedCreation = false;
  let deletionConfirmed = false;
  let db: TestDatabase | undefined;

  async function api(
    route: string,
    method = "GET",
    body?: Json,
  ): Promise<Json> {
    // Fixed HTTPS origin and no redirects. Never log credentials/API bodies.
    let response: Response;
    try {
      response = await fetch(`https://console.neon.tech/api/v2${route}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new SandboxError(
        "Neon API transport failure; request outcome may be unknown",
      );
    }
    if (!response.ok) throw new ApiFailure(response.status);
    if (response.status === 204) return {};
    try {
      return object(await response.json());
    } catch {
      throw new SandboxError("Neon API returned invalid JSON metadata");
    }
  }
  async function verifyParent() {
    const project = object((await api(prefix)).project);
    if (project.id !== projectId || project.name !== projectName)
      throw new SandboxError("Neon project mismatch");
    const parent = object((await api(`${prefix}/branches/${parentId}`)).branch);
    if (
      parent.id !== parentId ||
      parent.project_id !== projectId ||
      parent.name !== parentName
    ) {
      throw new SandboxError("Dedicated test parent branch mismatch");
    }
    if (parent.default !== false || !nonPrimary(parent.primary)) {
      throw new SandboxError(
        "Dedicated test parent must be explicitly non-default",
      );
    }
    // Metadata inspection only; no SQL connection to the parent.
    const databases = (await api(`${prefix}/branches/${parentId}/databases`))
      .databases;
    if (
      !Array.isArray(databases) ||
      !databases.some((value) => {
        const database = object(value);
        return database.name === "vfc_test" && database.branch_id === parentId;
      })
    ) {
      throw new SandboxError("Dedicated parent does not contain vfc_test");
    }
  }
  function verifyOwned(branch: Json) {
    if (
      !branchId ||
      !createdAt ||
      branchId === parentId ||
      branch.id !== branchId ||
      branch.project_id !== projectId ||
      branch.parent_id !== parentId ||
      branch.name !== runName ||
      branch.created_at !== createdAt ||
      branch.default !== false ||
      !nonPrimary(branch.primary) ||
      branch.protected !== false
    ) {
      throw new SandboxError(
        "Disposable branch ownership mismatch; deletion refused",
      );
    }
  }
  async function verifyChild(): Promise<Json> {
    const branch = object((await api(`${prefix}/branches/${branchId}`)).branch);
    verifyOwned(branch);
    return branch;
  }
  async function verifyEndpoint(): Promise<Json> {
    const endpoint = object(
      (await api(`${prefix}/endpoints/${endpointId}`)).endpoint,
    );
    if (
      endpoint.id !== endpointId ||
      endpoint.project_id !== projectId ||
      endpoint.branch_id !== branchId ||
      endpoint.type !== "read_write" ||
      endpoint.host !== endpointHost
    ) {
      throw new SandboxError("Disposable branch endpoint mismatch");
    }
    return endpoint;
  }
  async function dispose() {
    const failures: Error[] = [];
    if (db) {
      const closing = db;
      db = undefined;
      try {
        await bounded(closing.close(), "Prisma close");
      } catch (error) {
        failures.push(
          error instanceof CloseDeadlineError
            ? error
            : new SandboxError("Prisma close rejected"),
        );
      }
      try {
        await bounded(closing.pool.end(), "PostgreSQL pool close");
      } catch (error) {
        failures.push(
          error instanceof CloseDeadlineError
            ? error
            : new SandboxError("PostgreSQL pool close rejected"),
        );
      }
    }
    // After both close attempts settle OR their wait deadlines expire, attempt
    // verified branch deletion even if a close remains pending. Deletion may
    // sever those sessions; it does not prove the client close promises finished.
    if (branchId) {
      try {
        // ID originates in THIS run's POST response. No name-only lookup,
        // cascade flag, parent deletion, or unverified deletion.
        await verifyChild();
        await api(`${prefix}/branches/${branchId}`, "DELETE");
        const deadline = Date.now() + 20_000;
        for (;;) {
          try {
            await api(`${prefix}/branches/${branchId}`);
          } catch (error) {
            if (error instanceof ApiFailure && error.status === 404) {
              deletionConfirmed = true;
              branchId = undefined;
              break;
            }
            throw error;
          }
          if (Date.now() >= deadline)
            throw new SandboxError("Neon deletion confirmation timed out");
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      } catch {
        failures.push(
          new SandboxError(
            "Branch disposal failed or ownership could not be verified",
          ),
        );
      }
    } else if (attemptedCreation && !createdAt) {
      failures.push(
        new SandboxError(
          "Branch creation outcome unknown; no unverified branch was deleted",
        ),
      );
    }
    if (failures.length) {
      throw new AggregateError(
        failures,
        `Cleanup incomplete: project=${projectId} parent=${parentId} branch=${branchId ?? (deletionConfirmed ? "removed" : "unknown")} name=${runName}`,
      );
    }
  }

  try {
    await verifyParent();
    // Recovery breadcrumb even if the process is killed or POST response lost.
    console.info(
      `Creating report sandbox: project=${projectId} parent=${parentId} name=${runName} requested_at=${new Date().toISOString()}`,
    );
    attemptedCreation = true;
    const created = await api(`${prefix}/branches`, "POST", {
      branch: { parent_id: parentId, name: runName, protected: false },
      endpoints: [{ type: "read_write" }],
    });
    const branch = object(created.branch);
    branchId = resourceId(branch.id, "branch");
    createdAt = text(branch.created_at);
    verifyOwned(branch);
    console.info(
      `Report sandbox created: project=${projectId} branch=${branchId} name=${runName}`,
    );
    if (!Array.isArray(created.endpoints) || created.endpoints.length !== 1)
      throw new SandboxError("Expected one new endpoint");
    const endpoint = object(created.endpoints[0]);
    endpointId = resourceId(endpoint.id, "endpoint");
    endpointHost = text(endpoint.host);
    if (
      !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(endpointHost) ||
      endpointHost.includes("-pooler.")
    ) {
      throw new SandboxError("Expected a direct Neon endpoint hostname");
    }
    const deadline = Date.now() + 60_000;
    for (;;) {
      const child = await verifyChild();
      const compute = await verifyEndpoint();
      if (child.current_state === "ready" && compute.current_state === "active")
        break;
      if (Date.now() >= deadline)
        throw new SandboxError("Disposable branch readiness timed out");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const databases = (await api(`${prefix}/branches/${branchId}/databases`))
      .databases;
    const roles = (await api(`${prefix}/branches/${branchId}/roles`)).roles;
    if (
      !Array.isArray(databases) ||
      !databases.some((value) => {
        const database = object(value);
        return database.name === "vfc_test" && database.branch_id === branchId;
      }) ||
      !Array.isArray(roles) ||
      !roles.some((value) => {
        const candidate = object(value);
        return candidate.name === role && candidate.branch_id === branchId;
      })
    ) {
      throw new SandboxError("Child database or configured role is missing");
    }
    // protected:false does not establish password validity. Use only the
    // supplied secret to authenticate against THIS child and confirm current_user
    // below. No parent login, password lookup, role change or password reset.
    // In particular, a protected parent may yield different child credentials.
    // Build only from the verified child endpoint; ignore incoming test URLs.
    // Strict TLS hostname verification binds SQL to that endpoint.
    const url = new URL(`postgresql://${endpointHost}:5432/vfc_test`);
    url.username = role;
    url.password = password;
    url.searchParams.set("sslmode", "verify-full");
    url.searchParams.set("application_name", runName);
    const { openTestDatabase, requireTestDatabaseTarget } = await import(
      "./test-database"
    );
    const env = { ...process.env, TEST_DATABASE_URL: url.toString() };
    requireTestDatabaseTarget(env);
    try {
      db = await openTestDatabase(env, {
        max: 3,
        connectionTimeoutMillis: 10_000,
      });
    } catch (error) {
      throw new SandboxError(
        error instanceof AggregateError
          ? "Opening the child database and closing its failed connections both failed"
          : "Could not open the validated disposable branch database",
      );
    }
    const client = await db.pool.connect();

    try {
      const identity = await client.query<{
        database: string;
        role: string;
        application: string;
      }>(
        `SELECT current_database() AS database,
           current_user AS role,
           current_setting('application_name') AS application`,
      );

      const actual = identity.rows[0];

      const socket = (
        client as unknown as {
          connection?: {
            stream?: {
              encrypted?: boolean;
              authorized?: boolean;
            };
          };
        }
      ).connection?.stream;

      const mismatches = [
        actual?.database !== "vfc_test" ? "database" : null,
        actual?.role !== role ? "role" : null,
        actual?.application !== runName ? "application" : null,
        socket?.encrypted !== true ? "tls-encryption" : null,
        socket?.authorized !== true ? "tls-certificate" : null,
      ].filter((value): value is string => value !== null);

      if (mismatches.length > 0) {
        throw new SandboxError(
          `Disposable PostgreSQL identity mismatch: ${mismatches.join(", ")}`,
        );
      }
    } finally {
      client.release();
    }
    // Final API attestation after SQL handshake, before returning a write client.
    await verifyParent();
    await verifyChild();
    await verifyEndpoint();
    return { db, dispose, applicationName: runName };
  } catch (error) {
    // Controlled messages only: raw driver errors can contain credentials.
    const setupError =
      error instanceof SandboxError
        ? error
        : new SandboxError("Neon report sandbox setup failed");
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [setupError, cleanupError],
        `Setup/cleanup failed: project=${projectId} name=${runName}`,
      );
    }
    throw setupError;
  }
}
