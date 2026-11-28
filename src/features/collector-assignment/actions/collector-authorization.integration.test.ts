/** Opt-in disposable PostgreSQL, never a production database.
 * Actual actions, authorization, locks, retries and audits. Only preflight
 * identity/navigation/global-client boundaries and explicit clock cases below
 * are substituted. Payment fixture uses Phase 3B authority, not legacy actions.
 * For local runs, set VFC_RUN_COLLECTOR_LOCAL_TESTS=1 and use a disposable
 * TEST_DATABASE_URL with permission to create fresh databases.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { describe, expect, it, vi } from "vitest";
import { activate } from "@/features/fund-management/lib/fund-schema-test-support";
import { withReleaseDatabase } from "@/test-support/phase7-release-sandbox";
import { requireTestDatabaseTarget } from "@/test-support/test-database";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import { getCurrentPeriod } from "@/lib/authz/collector-period";
import { authorizeFinancialTransaction } from "@/lib/authz/transaction-authority";
import { beginHouseholdWrite } from "@/features/household-management/lib/household-write";
import { removeMemberAndDeactivateAssignments } from "@/features/household-management/lib/remove-member-transaction";
import { withSerializableRetry } from "@/lib/db/transaction";
import { inspectDatabaseError } from "@/lib/db/database-errors";
import { createFinancialAudit } from "@/lib/audit/financial-audit";
import { assignCollectorAction } from "./assign-collector.action";
import { deactivateCollectorAssignmentAction } from "./deactivate-collector-assignment.action";
const boundary = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  before: null as null | ((tx: Prisma.TransactionClient) => Promise<void>),
  after: null as null | (() => Promise<void>),
  clock: null as Date | null,
}));
vi.mock("@/lib/authz", async () => ({
  requireChief: async () => ({ user: { id: "chief" }, villageId: "v" }),
  getCurrentPeriod: (await import("@/lib/authz/collector-period")).getCurrentPeriod,
}));
vi.mock("@/lib/auth/session-identity", () => ({ getSessionIdentity: vi.fn() }));
class Navigation extends Error { constructor(readonly path: string) { super(path); } }
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Navigation(path); } }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get(_target, key) {
  const client = boundary.client!;
  if (key === "$transaction") return (body: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => client.$transaction(async (real) => {
    const tx = clockClient(real);
    await boundary.before?.(tx);
    const result = await body(tx);
    await boundary.after?.();
    return result;
  }, { ...options, timeout: 15000 });
  const value = Reflect.get(client, key);
  return typeof value === "function" ? value.bind(client) : value;
} }) }));
// Explicit clock substitution is local to this test client. All other SQL runs
// unchanged. It does not override any production trigger's database clock.
function clockClient(tx: Prisma.TransactionClient): Prisma.TransactionClient {
  return new Proxy(tx, { get(target, key) {
    if (key === "$queryRaw" && boundary.clock) return (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.join("").trim() === "SELECT clock_timestamp() AS now"
        ? target.$queryRaw`SELECT ${boundary.clock}::timestamptz AS now`
        : target.$queryRaw(strings, ...values);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.VFC_ALLOW_MIGRATION_TESTS === "1";
const migrationRoot = join(process.cwd(), "prisma/migrations");
const collectorMigration = "20261128130000_one_active_collector_per_village_period";
const activeIndex = "CollectorAssignment_one_active_per_village_period";
const historicalIndex = "CollectorAssignment_villageId_userId_year_month_key";
const fixtureCollision = "Village 'v', year 2026, month 11: active assignment IDs {first,second}";
const rollbackDiagnostic = "Assignment rows were not modified. The new index was not created.";
const readMigration = (name: string) => readFile(join(migrationRoot, name, "migration.sql"), "utf8");

async function withDisposableDatabase(run: (raw: Client, url: string) => Promise<void>) {
  if (process.env.VFC_RUN_COLLECTOR_LOCAL_TESTS !== "1") {
    return withReleaseDatabase("fresh", run);
  }

  const { url, database } = requireTestDatabaseTarget({
    ...process.env,
    TEST_DATABASE_ALLOW_REMOTE: undefined,
  });
  const admin = new Client({ connectionString: url });
  await admin.connect();
  try {
    const { rows: [identity] } = await admin.query<{ name: string }>("SELECT current_database() AS name");
    if (identity.name !== database) throw new Error("Collector test database identity mismatch");

    const childName = `vfc_test_collector_${randomUUID().replaceAll("-", "")}`;
    const childUrl = new URL(url);
    childUrl.pathname = `/${childName}`;
    const raw = new Client({ connectionString: childUrl.toString() });
    await admin.query(`CREATE DATABASE "${childName}" TEMPLATE template0`);
    try {
      await raw.connect();
      const { rows: [child] } = await raw.query<{ name: string }>("SELECT current_database() AS name");
      if (child.name !== childName) throw new Error("Collector test child database identity mismatch");
      await run(raw, childUrl.toString());
    } finally {
      try {
        await raw.end();
      } finally {
        await admin.query(`DROP DATABASE "${childName}"`);
      }
    }
  } finally {
    await admin.end();
  }
}

async function applyMigrations(raw: Client, beforeCollectorIndex: boolean) {
  const names = (await readdir(migrationRoot)).filter((name) => /^\d/.test(name)).sort();
  for (const name of names) {
    if (beforeCollectorIndex && name >= collectorMigration) break;
    await raw.query(await readMigration(name));
  }
}

async function indexDefinition(raw: Client, name = activeIndex) {
  const { rows } = await raw.query<{ indexdef: string }>(
    "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1",
    [name],
  );
  return rows[0]?.indexdef;
}

function migrationCommand(url: string, command: "npm" | "npx", args: string[]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 30_000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      NODE_ENV: "test",
      DATABASE_URL: url,
    },
  });
  if (result.error || result.status === null) {
    throw new Error(`Migration fixture command did not exit normally: ${command} ${args[0]}`);
  }
  const output = (result.stdout + result.stderr).replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted database URL]");
  return { status: result.status, output };
}

async function deployBaseline(url: string) {
  const directory = await mkdtemp(join(tmpdir(), "vfc-collector-baseline-"));
  try {
    const migrations = join(directory, "prisma", "migrations");
    await mkdir(migrations, { recursive: true });
    await symlink(join(process.cwd(), "node_modules"), join(directory, "node_modules"), "junction");
    await cp("prisma.config.ts", join(directory, "prisma.config.ts"));
    await cp("prisma/schema.prisma", join(directory, "prisma/schema.prisma"));
    for (const name of await readdir(migrationRoot)) {
      if (name === "migration_lock.toml" || (/^\d/.test(name) && name < collectorMigration)) {
        await cp(join(migrationRoot, name), join(migrations, name), { recursive: true });
      }
    }
    const baseline = migrationCommand(url, "npm", ["run", "db:deploy", "--", "--config", join(directory, "prisma.config.ts")]);
    expect(baseline.status, baseline.output).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function collectorMigrationHistory(raw: Client) {
  return (await raw.query<{
    finished: boolean;
    rolledBack: boolean;
    appliedSteps: number;
    logs: string | null;
  }>(`
    SELECT finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS "rolledBack",
           applied_steps_count AS "appliedSteps", logs
    FROM public."_prisma_migrations"
    WHERE migration_name = $1
    ORDER BY started_at
  `, [collectorMigration])).rows;
}

async function insertAssignment(
  raw: Client, id: string, userId: string,
  { villageId = "v", year = 2026, month = 11, isActive = true } = {},
) {
  await raw.query(
    `INSERT INTO "CollectorAssignment"(id,"villageId","userId",year,month,"isActive","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,now())`,
    [id, villageId, userId, year, month, isActive],
  );
}

async function persistedAssignments(raw: Client) {
  return (await raw.query('SELECT * FROM "CollectorAssignment" ORDER BY id')).rows;
}

async function seedCollectorMembers(raw: Client) {
  await raw.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ('v','v','Test',now())`);
  await raw.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ('v','v','H1',now())`);
  await raw.query(`INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt") VALUES
    ('chief','v',NULL,'CHIEF','ACTIVE','Chief','unused',now()),
    ('head','v','v','VILLAGER','ACTIVE','Head','unused',now()),
    ('collector','v','v','VILLAGER','ACTIVE','Collector','unused',now()),
    ('alternate','v','v','VILLAGER','ACTIVE','Alternate','unused',now())`);
  await raw.query(`UPDATE "House" SET "headOfHouseId"='head' WHERE id='v'`);
}

function barrier() { let open!: () => void; const reached = new Promise<void>((resolve) => { open = resolve; }); return { open, reached }; }
function observe<T>(promise: Promise<T>) { return promise.then((value) => ({ value }), (error: unknown) => ({ error })); }
async function reached<T>(gate: ReturnType<typeof barrier>, pending: ReturnType<typeof observe<T>>) {
  await Promise.race([gate.reached, pending.then((out) => { if ("error" in out) throw out.error; throw new Error("Operation ended before barrier"); })]);
}
function identity(id = "chief") { vi.mocked(getSessionIdentity).mockResolvedValue({ userId: id, sessionVersion: 0 }); }
function form(userId = "collector", period = getCurrentPeriod()) {
  const data = new FormData(); data.set("userId", userId); data.set("year", String(period.year)); data.set("month", String(period.month)); return data;
}
function deactivate(id = "assignment") { const data = new FormData(); data.set("assignmentId", id); return deactivateCollectorAssignmentAction(data); }
async function deactivated(id?: string) { await expect(deactivate(id)).rejects.toMatchObject({ path: "/village/collectors" }); }
const transaction = <T>(p: PrismaClient, body: (tx: Prisma.TransactionClient) => Promise<T>) => withSerializableRetry(() => p.$transaction(body, { isolationLevel: "Serializable", timeout: 15000 }));
async function fixture(
  run: (p: PrismaClient, other: PrismaClient, raw: Client) => Promise<void>,
  { beforeCollectorIndex = false } = {},
) {
  await withDisposableDatabase(async (raw, url) => {
    await applyMigrations(raw, beforeCollectorIndex);
    await seedCollectorMembers(raw);
    const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const other = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    boundary.client = p; boundary.before = null; boundary.after = null; boundary.clock = null; identity();
    let failed = false;
    try { await run(p, other, raw); } catch (error) { failed = true; throw error; }
    finally {
      boundary.before = null; boundary.after = null; boundary.clock = null; boundary.client = null;
      const results = await Promise.allSettled([p.$disconnect(), other.$disconnect()]);
      for (const result of results) if (result.status === "rejected") { if (!failed) throw result.reason; console.error("Collector fixture cleanup failed", result.reason); }
    }
  });
}
async function assignment(p: PrismaClient) {
  const period = getCurrentPeriod();
  await p.collectorAssignment.create({ data: { id: "assignment", villageId: "v", userId: "collector", ...period } });
}
async function payment(tx: Prisma.TransactionClient) {
  await authorizeFinancialTransaction(tx, { villageId: "v", permission: "collector", fundIds: ["v"], houseIds: ["v"] });
  await tx.payment.create({ data: { id: "payment", villageId: "v", fundId: "v", houseId: "v", fundHouseAssessmentId: "v", payerUserId: "head", collectorUserId: "collector", amount: 1001 } });
  await tx.receipt.create({ data: { id: "receipt", receiptNumber: "TEST-RECEIPT", paymentId: "payment", villageId: "v" } });
  await createFinancialAudit(tx, { event: "PAYMENT_CREATED", villageId: "v", fundId: "v", actorUserId: "collector", metadata: { paymentId: "payment", houseId: "v", assessmentId: "v", amount: 1001 } });
  await createFinancialAudit(tx, { event: "RECEIPT_CREATED", villageId: "v", fundId: "v", actorUserId: "collector", metadata: { paymentId: "payment", receiptId: "receipt", receiptNumber: "TEST-RECEIPT" } });
}
describe.skipIf(!enabled)("Phase 3E collector transactions", () => {
  it("enforces the exact partial index on a fresh schema for inserts and reactivations", async () => {
    await fixture(async (_p, _other, raw) => {
      expect(await indexDefinition(raw)).toBe(
        'CREATE UNIQUE INDEX "CollectorAssignment_one_active_per_village_period" ON public."CollectorAssignment" USING btree ("villageId", year, month) WHERE ("isActive" = true)',
      );

      await insertAssignment(raw, "original", "collector");
      const original = await persistedAssignments(raw);
      await expect(insertAssignment(raw, "conflict", "alternate"))
        .rejects.toMatchObject({ code: "23505", constraint: activeIndex });
      expect(await persistedAssignments(raw)).toEqual(original);

      await insertAssignment(raw, "inactive", "alternate", { isActive: false });
      await insertAssignment(raw, "inactive-head", "head", { isActive: false });
      await insertAssignment(raw, "other-month", "alternate", { month: 12 });
      await insertAssignment(raw, "other-year", "collector", { year: 2027 });
      await raw.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ('other','other','Other',now())`);
      await raw.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ('other','other','H1',now())`);
      await raw.query(`INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt")
        VALUES ('other-collector','other','other','VILLAGER','ACTIVE','Other Collector','unused',now())`);
      await raw.query(`UPDATE "House" SET "headOfHouseId"='other-collector' WHERE id='other'`);
      await insertAssignment(raw, "other-village", "other-collector", { villageId: "other" });

      const withHistory = await persistedAssignments(raw);
      await expect(raw.query('UPDATE "CollectorAssignment" SET "isActive"=true WHERE id=$1', ["inactive"]))
        .rejects.toMatchObject({ code: "23505", constraint: activeIndex });
      await expect(insertAssignment(raw, "duplicate-history", "alternate", { isActive: false }))
        .rejects.toMatchObject({ code: "23505", constraint: historicalIndex });
      expect(await persistedAssignments(raw)).toEqual(withHistory);
      expect(withHistory).toHaveLength(6);
    });
  }, 60000);

  it("upgrades the previous migration chain without altering assignment history", async () => {
    await fixture(async (_p, _other, raw) => {
      expect(await indexDefinition(raw)).toBeUndefined();
      await insertAssignment(raw, "current", "collector");
      await insertAssignment(raw, "former", "alternate", { isActive: false });
      await insertAssignment(raw, "past", "collector", { month: 10 });
      const before = await persistedAssignments(raw);

      await raw.query(await readMigration(collectorMigration));

      expect(await indexDefinition(raw)).toContain('WHERE ("isActive" = true)');
      expect(await persistedAssignments(raw)).toEqual(before);
      await expect(insertAssignment(raw, "conflict", "head"))
        .rejects.toMatchObject({ code: "23505", constraint: activeIndex });
    }, { beforeCollectorIndex: true });
  }, 60000);

  it("refuses a deliberately colliding migration fixture and preserves both rows", async () => {
    await fixture(async (_p, _other, raw) => {
      await insertAssignment(raw, "first", "collector");
      await insertAssignment(raw, "second", "alternate");
      const before = await persistedAssignments(raw);
      await expect(raw.query(await readMigration(collectorMigration))).rejects.toMatchObject({
        code: "23505",
        message: "Cannot enforce one active Collector assignment per village and period. "
          + `Migration ${collectorMigration}. ${fixtureCollision}. ${rollbackDiagnostic}`,
        detail: fixtureCollision,
      });
      expect(await indexDefinition(raw)).toBeUndefined();
      expect(await persistedAssignments(raw)).toEqual(before);
    }, { beforeCollectorIndex: true });
  }, 60000);

  it("reports the collision through the deployment command and supports Prisma recovery", async () => {
    await withDisposableDatabase(async (raw, url) => {
      await deployBaseline(url);
      await seedCollectorMembers(raw);
      await insertAssignment(raw, "first", "collector");
      await insertAssignment(raw, "second", "alternate");
      const before = await persistedAssignments(raw);
      const originalIndex = await indexDefinition(raw, historicalIndex);
      expect(originalIndex).toBe(
        'CREATE UNIQUE INDEX "CollectorAssignment_villageId_userId_year_month_key" ON public."CollectorAssignment" USING btree ("villageId", "userId", year, month)',
      );
      expect(await collectorMigrationHistory(raw)).toEqual([]);

      const failed = migrationCommand(url, "npm", ["run", "db:deploy"]);
      expect(failed.status, failed.output).toBe(1);
      expect(failed.output).toContain("P3018");
      expect(failed.output).toContain("Database error code: 23505");
      expect(failed.output).toContain(`Migration name: ${collectorMigration}`);
      expect(failed.output).toContain(fixtureCollision);
      expect(failed.output).toContain(rollbackDiagnostic);
      expect(await persistedAssignments(raw)).toEqual(before);
      expect(await indexDefinition(raw)).toBeUndefined();
      expect(await indexDefinition(raw, historicalIndex)).toBe(originalIndex);
      expect(await collectorMigrationHistory(raw)).toEqual([{
        finished: false, rolledBack: false, appliedSteps: 0, logs: expect.stringContaining(fixtureCollision),
      }]);

      const blockedRetry = migrationCommand(url, "npm", ["run", "db:deploy"]);
      expect(blockedRetry.status, blockedRetry.output).toBe(1);
      expect(blockedRetry.output).toContain("P3009");

      // Model an approved one-row resolution in this disposable fixture only.
      const resolution = await raw.query('UPDATE "CollectorAssignment" SET "isActive" = false WHERE id = $1', ["second"]);
      expect(resolution.rowCount).toBe(1);
      const resolved = before.map((row) => row.id === "second" ? { ...row, isActive: false } : row);
      expect(await persistedAssignments(raw)).toEqual(resolved);

      const recovery = migrationCommand(url, "npx", ["--no-install", "prisma", "migrate", "resolve", "--rolled-back", collectorMigration]);
      expect(recovery.status, recovery.output).toBe(0);
      expect(recovery.output).toContain(`Migration ${collectorMigration} marked as rolled back.`);
      const retry = migrationCommand(url, "npm", ["run", "db:deploy"]);
      expect(retry.status, retry.output).toBe(0);
      expect(retry.output).toContain(`Applying migration \`${collectorMigration}\``);
      expect(await collectorMigrationHistory(raw)).toEqual([
        { finished: false, rolledBack: true, appliedSteps: 0, logs: expect.stringContaining(fixtureCollision) },
        { finished: true, rolledBack: false, appliedSteps: 1, logs: null },
      ]);
      expect(await persistedAssignments(raw)).toEqual(resolved);
      expect(await indexDefinition(raw, historicalIndex)).toBe(originalIndex);
      expect(await indexDefinition(raw)).toBe(
        'CREATE UNIQUE INDEX "CollectorAssignment_one_active_per_village_period" ON public."CollectorAssignment" USING btree ("villageId", year, month) WHERE ("isActive" = true)',
      );
    });
  }, 180_000);

  it("retires through the Chief action and replaces the collector while retaining history", async () => {
    await fixture(async (p) => {
      const period = getCurrentPeriod();
      expect(await assignCollectorAction(form("collector", period))).toEqual({ success: true });
      const original = await p.collectorAssignment.findFirstOrThrow({ where: { villageId: "v", ...period } });
      await deactivated(original.id);
      const retired = await p.collectorAssignment.findUniqueOrThrow({ where: { id: original.id } });
      expect(retired).toMatchObject({ userId: "collector", ...period, isActive: false });

      expect(await assignCollectorAction(form("alternate", period))).toEqual({ success: true });
      expect(await p.collectorAssignment.findUnique({ where: { id: original.id } })).toEqual(retired);
      const active = await p.collectorAssignment.findMany({ where: { villageId: "v", ...period, isActive: true } });
      expect(active).toEqual([expect.objectContaining({ userId: "alternate" })]);
      expect(await p.auditLog.count({ where: { entityId: original.id, actionType: "STATUS_CHANGE" } })).toBe(1);
      expect(await p.auditLog.count({ where: { entityId: active[0].id, actionType: "ASSIGN" } })).toBe(1);
    });
  }, 60000);

  it.each([
    ["role", "assign"], ["membership", "assign"], ["role", "deactivate"], ["membership", "deactivate"],
  ] as const)("committed Chief %s revocation is rechecked by %s after a complete retry", async (change, operation) => {
    await fixture(async (p, _other, raw) => {
      if (operation === "deactivate") await assignment(p);
      const snapshot = barrier(); const release = barrier(); let attempts = 0;
      boundary.before = async (tx) => { attempts += 1; if (attempts === 1) { await tx.$queryRaw`SELECT id FROM "Village" WHERE id='v'`; snapshot.open(); await release.reached; } };
      const pending = observe((async () => operation === "assign" ? await assignCollectorAction(form()) : await deactivate())());
      try {
        await reached(snapshot, pending);
        await raw.query("BEGIN");
        await raw.query(`SELECT public.vfc_acquire_villages(ARRAY['v']::text[])`);
        await raw.query(change === "role" ? `UPDATE "User" SET role='VILLAGER' WHERE id='chief'` : `UPDATE "User" SET "membershipStatus"='REMOVED' WHERE id='chief'`);
        await raw.query("COMMIT"); release.open();
        expect(await pending).toMatchObject({ error: { path: "/forbidden" } });
        expect(attempts).toBe(2);
        expect(await p.collectorAssignment.count({ where: { isActive: true } })).toBe(operation === "assign" ? 0 : 1);
        expect(await p.auditLog.count()).toBe(0);
      } finally { release.open(); await raw.query("ROLLBACK").catch((error: unknown) => console.error("Rollback cleanup failed", error)); await pending; }
    });
  }, 60000);
  it("an assignment change holding authority commits before later Chief revocation", async () => {
    await fixture(async (p, _other, raw) => {
      const written = barrier(); const release = barrier();
      boundary.after = async () => { written.open(); await release.reached; };
      const pending = observe(assignCollectorAction(form()));
      try {
        await reached(written, pending);
        await raw.query("BEGIN");
        await expect(raw.query(`SELECT public.vfc_acquire_villages(ARRAY['v']::text[])`)).rejects.toMatchObject({ code: "40001", message: "VFC_SCOPE_BUSY_RETRY_TRANSACTION" });
        await raw.query("ROLLBACK"); release.open();
        expect(await pending).toEqual({ value: { success: true } }); boundary.after = null;
        await raw.query(`UPDATE "User" SET role='VILLAGER' WHERE id='chief'`);
        await expect(assignCollectorAction(form("alternate"))).rejects.toMatchObject({ path: "/forbidden" });
        expect(await p.collectorAssignment.count({ where: { isActive: true } })).toBe(1);
        expect(await p.auditLog.count({ where: { actionType: "ASSIGN" } })).toBe(1);
      } finally { release.open(); await raw.query("ROLLBACK").catch((error: unknown) => console.error("Rollback cleanup failed", error)); await pending; }
    });
  }, 60000);
  it("simultaneous assignment actions serialize and preserve a single assignment and audit", async () => {
    await fixture(async (p, other, raw) => {
      const period = getCurrentPeriod();
      const written = barrier(); const release = barrier();
      let firstPid: number | undefined;
      boundary.before = async (tx) => {
        const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        firstPid = backend.pid;
      };
      boundary.after = async () => { written.open(); await release.reached; };
      const first = observe(assignCollectorAction(form("collector", period)));
      let second: ReturnType<typeof observe<Awaited<ReturnType<typeof assignCollectorAction>>>> | undefined;
      try {
        await reached(written, first);
        // Probe the exact NOWAIT abort, then start a stale action snapshot on
        // another independent connection; release only after it is established.
        await raw.query("BEGIN");
        await expect(raw.query(`SELECT public.vfc_acquire_villages(ARRAY['v']::text[])`)).rejects.toMatchObject({ code: "40001", message: "VFC_SCOPE_BUSY_RETRY_TRANSACTION" });
        await raw.query("ROLLBACK");
        const snapshot = barrier(); const committed = barrier(); let attempts = 0;
        boundary.client = other;
        boundary.before = async (tx) => {
          attempts += 1;
          if (attempts === 1) {
            const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid FROM "Village" WHERE id='v'`;
            expect(firstPid).toEqual(expect.any(Number));
            expect(backend.pid).not.toBe(firstPid);
            snapshot.open();
            await committed.reached;
          }
        };
        second = observe(assignCollectorAction(form("alternate", period)));
        try {
          await reached(snapshot, second); release.open();
          expect(await first).toEqual({ value: { success: true } }); boundary.after = null; committed.open();
          expect(await second).toMatchObject({ value: { success: false, formError: "An active Collector already exists for the selected period. Deactivate the existing assignment first." } });
          expect(attempts).toBe(2);
          const rows = await p.collectorAssignment.findMany();
          expect(rows).toEqual([expect.objectContaining({ userId: "collector", isActive: true, villageId: "v", ...period })]);
          expect(await p.auditLog.findMany()).toEqual([expect.objectContaining({
            actionType: "ASSIGN",
            entityId: rows[0].id,
            metadata: expect.objectContaining({ assignedUserId: "collector" }),
          })]);
        } finally { committed.open(); }
      } finally { release.open(); await raw.query("ROLLBACK").catch((error: unknown) => console.error("Rollback cleanup failed", error)); await first; await second; }
    });
  }, 60000);
  it.each(["revocation-first", "payment-first"] as const)("%s preserves transactional payment authority and history", async (ordering) => {
    await fixture(async (p, other, raw) => {
      await assignment(p);
      await raw.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") VALUES ('v','v','Test',1001,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date-1,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date+1,now())`);
      await raw.query("BEGIN"); await activate(raw, "v"); await raw.query("COMMIT");
      if (ordering === "revocation-first") {
        await deactivated(); identity("collector");
        await expect(transaction(other, payment)).rejects.toMatchObject({ code: "VFC_AUTH_COLLECTOR" });
        expect(await p.payment.count()).toBe(0); expect(await p.receipt.count()).toBe(0);
      } else {
        identity("collector"); const written = barrier(); const release = barrier();
        const pending = observe(transaction(other, async (tx) => { await payment(tx); written.open(); await release.reached; }));
        try {
          await reached(written, pending); identity();
          await raw.query("BEGIN");
          await expect(raw.query(`SELECT public.vfc_acquire_villages(ARRAY['v']::text[])`)).rejects.toMatchObject({ code: "40001", message: "VFC_SCOPE_BUSY_RETRY_TRANSACTION" });
          await raw.query("ROLLBACK"); release.open(); expect(await pending).toEqual({ value: undefined });
          await deactivated();
          expect(await p.payment.findUnique({ where: { id: "payment" } })).toMatchObject({ status: "ACCEPTED", collectorUserId: "collector" });
          expect(await p.receipt.findUnique({ where: { id: "receipt" } })).toMatchObject({ status: "ACTIVE" });
          expect(await p.auditLog.count({ where: { fundId: "v" } })).toBe(2);
        } finally { release.open(); await raw.query("ROLLBACK").catch((error: unknown) => console.error("Rollback cleanup failed", error)); await pending; }
      }
      expect(await p.collectorAssignment.findUnique({ where: { id: "assignment" } })).toMatchObject({ isActive: false });
      expect(await p.auditLog.count({ where: { entityId: "assignment", actionType: "STATUS_CHANGE" } })).toBe(1);
    });
  }, 60000);
  it("member removal and Chief deactivation serialize without duplicate revocation audits", async () => {
    await fixture(async (p, other, raw) => {
      await assignment(p); identity("head");
      const written = barrier(); const release = barrier();
      const pending = observe(transaction(other, async (tx) => {
        const guard = await beginHouseholdWrite(tx, { villageId: "v", permission: "head", actorUserId: "head", houseIds: ["v"], targetUserIds: ["collector"], deactivateAssignmentsFor: "collector" });
        expect(guard.ok).toBe(true);
        await removeMemberAndDeactivateAssignments(tx, { villageId: "v", houseId: "v", actorUserId: "head", targetUserId: "collector", currentPeriod: getCurrentPeriod() });
        written.open(); await release.reached;
      }));
      try {
        await reached(written, pending); identity();
        await raw.query("BEGIN");
        await expect(raw.query(`SELECT public.vfc_acquire_villages(ARRAY['v']::text[])`)).rejects.toMatchObject({ code: "40001", message: "VFC_SCOPE_BUSY_RETRY_TRANSACTION" });
        await raw.query("ROLLBACK"); release.open(); expect(await pending).toEqual({ value: undefined }); await deactivated();
        expect(await p.user.findUnique({ where: { id: "collector" } })).toMatchObject({ membershipStatus: "REMOVED" });
        expect(await p.collectorAssignment.findUnique({ where: { id: "assignment" } })).toMatchObject({ isActive: false });
        expect(await p.auditLog.count({ where: { entityId: "assignment" } })).toBe(1);
        expect(await p.auditLog.count({ where: { entityId: "collector", actionType: "REMOVE" } })).toBe(1);
      } finally { release.open(); await raw.query("ROLLBACK").catch((error: unknown) => console.error("Rollback cleanup failed", error)); await pending; }
    });
  }, 60000);
  it.each(["removed", "chief", "missing"] as const)("rejects an ineligible %s target without assignment or audit writes", async (kind) => {
    await fixture(async (p) => {
      if (kind === "removed") await p.user.update({ where: { id: "collector" }, data: { membershipStatus: "REMOVED" } });
      if (kind === "chief") await p.user.update({ where: { id: "collector" }, data: { role: "CHIEF" } });
      expect(await assignCollectorAction(form(kind === "missing" ? "absent" : "collector")))
        .toMatchObject({ success: false, fieldErrors: { userId: "Selected user is not an active member of this village." } });
      expect(await p.collectorAssignment.count()).toBe(0);
      expect(await p.auditLog.count()).toBe(0);
    });
  }, 60000);
  it("rechecks assignment/deactivation periods at the Yangon month rollover", async () => {
    await fixture(async (p) => {
      await assignment(p);
      const period = getCurrentPeriod();
      const after = new Date(Date.UTC(period.year, period.month, 1, -6, -30));
      const before = new Date(after.getTime() - 1);
      expect(getCurrentPeriod(before)).toEqual(period);
      boundary.clock = after;
      expect(await assignCollectorAction(form("alternate", period))).toMatchObject({ success: false, fieldErrors: { month: "Cannot assign a collector for a past period." } });
      await deactivated(); // Past assignment remains active; no deactivation audit.
      expect(await p.collectorAssignment.findUnique({ where: { id: "assignment" } })).toMatchObject({ isActive: true });
      expect(await p.auditLog.count()).toBe(0);
      identity("collector");
      boundary.clock = before;
      expect(await transaction(p, (tx) => authorizeFinancialTransaction(clockClient(tx), { villageId: "v", permission: "collector" })))
        .toMatchObject({ assignmentId: "assignment" });
      boundary.clock = after;
      await expect(transaction(p, (tx) => authorizeFinancialTransaction(clockClient(tx), { villageId: "v", permission: "collector" })))
        .rejects.toMatchObject({ code: "VFC_AUTH_COLLECTOR" });
    });
  }, 60000);
});
