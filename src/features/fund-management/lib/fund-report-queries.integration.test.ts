import { trackReleaseLifecycle, finishReleaseSetup } from "@/test-support/phase7-release-registry";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { TestDatabase } from "@/test-support/test-database";
import { inspectDatabaseError } from "@/lib/db/database-errors";

const boundary = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  chief: "",
  village: "",
}));
vi.mock("@/lib/authz/roles", () => ({
  requireChief: async () => ({
    user: { id: boundary.chief },
    villageId: boundary.village,
  }),
}));
vi.mock("@/lib/auth/session-identity", () => ({
  getSessionIdentity: async () => ({
    userId: boundary.chief,
    sessionVersion: 0,
  }),
}));
// Dependency injection only: all queries execute on openTestDatabase's REAL
// Prisma client. Never import the application singleton (uses DATABASE_URL).
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    if (!boundary.client) throw new Error("Validated test client is not open");
    return boundary.client;
  },
}));

// Opt-in executes the suite; there is no unconditional skip or existing DB target.
describe.skipIf(process.env.VFC_RUN_REPORT_POSTGRES_TESTS !== "1")(
  "fund report reader (owned Neon branch)",
  { concurrent: false, shuffle: false },
  () => {
    let db: TestDatabase;
    let sandbox:
      | Awaited<
          ReturnType<
            typeof import("@/test-support/report-postgres-sandbox").startReportPostgresSandbox
          >
        >
      | undefined;
    let read: typeof import("./fund-report-queries").getChiefFundReport;
    const uid = () => `report-it-${randomUUID()}`;
    let villages: string[] = [];
    let users: string[] = [];
    let houses: string[] = [];
    let funds: string[] = []; // ACTIVE, own DRAFT, foreign DRAFT
    let assessments: string[] = [];
    let payments: string[] = [];
    let receipts: string[] = [];

    let setup: Promise<void> | undefined;
    beforeAll(() => {
      const work = async () => {
        const { startReportPostgresSandbox } = await import(
          "@/test-support/report-postgres-sandbox"
        );
        sandbox = await startReportPostgresSandbox();
        db = sandbox.db;
        // The inherited branch must carry the financial schema AND its guards:
        // every fixture below is created with production constraints enabled.
        for (const table of [
          "Fund",
          "FundHouseAssessment",
          "Payment",
          "Receipt",
        ]) {
          const found = await db.pool.query<{ found: string | null }>(
            "SELECT to_regclass($1) AS found",
            [`public."${table}"`],
          );
          if (!found.rows[0]?.found)
            throw new Error(
              `Disposable branch is missing the "${table}" table; apply migrations to the dedicated parent first`,
            );
        }
        const guards = await db.pool.query<{ tgname: string }>(
          `SELECT DISTINCT t.tgname FROM pg_trigger t
          JOIN pg_class r ON r.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace
          WHERE n.nspname = 'public' AND NOT t.tgisinternal
          AND t.tgname IN ('vfc_validate_work','vfc_fund_guard','vfc_record_guard','vfc_transition_check')`,
        );
        expect(guards.rows.map((row) => row.tgname).sort()).toEqual([
          "vfc_fund_guard",
          "vfc_record_guard",
          "vfc_transition_check",
          "vfc_validate_work",
        ]);
      };
      setup = process.env.VFC_RUN_PHASE7_RELEASE === "1" ? trackReleaseLifecycle(work) : work();
      return setup;
    }, process.env.VFC_RUN_PHASE7_RELEASE === "1" ? 0 : 300_000);
    beforeEach(async () => {
      villages = [uid(), uid()];
      users = [uid(), uid(), uid()];
      houses = [uid(), uid(), uid()];
      funds = [uid(), uid(), uid()];
      assessments = [uid(), uid(), uid()];
      payments = [uid(), uid()];
      receipts = [uid(), uid()];
      const c = await db.pool.connect();
      try {
        await c.query("BEGIN");
        for (const village of villages) {
          await c.query(
            `INSERT INTO "Village"(id,"villageCode",name,"updatedAt")
          VALUES ($1,$1,'Report integration',now())`,
            [village],
          );
        }
        for (let i = 0; i < houses.length; i++) {
          await c.query(
            `INSERT INTO "House"(id,"villageId","houseNumber","updatedAt")
          VALUES ($1,$2,$3,now())`,
            [houses[i], villages[0], `H${i}`],
          );
          await c.query(
            `INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt")
          VALUES ($1,$2,$3,$4::"UserRole",'ACTIVE','Report member','unused',now())`,
            [users[i], villages[0], houses[i], i === 0 ? "CHIEF" : "VILLAGER"],
          );
          await c.query('UPDATE "House" SET "headOfHouseId"=$2 WHERE id=$1', [
            houses[i],
            users[i],
          ]);
        }
        for (let i = 0; i < funds.length; i++) {
          await c.query(
            `INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt")
          VALUES ($1,$2,'Report fund',1001,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date-1,
          (clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date+1,now())`,
            [funds[i], i === 2 ? villages[1] : villages[0]],
          );
        }
        for (let i = 0; i < houses.length; i++) {
          await c.query(
            `INSERT INTO "FundHouseAssessment"(id,"fundId","houseId","villageId","assessmentAmount","houseNumberSnapshot")
          VALUES ($1,$2,$3,$4,334,$5)`,
            [assessments[i], funds[0], houses[i], villages[0], `H${i}`],
          );
        }
        await c.query(
          `UPDATE "Fund" SET status='ACTIVE',"eligibleHouseCount"=3,"assessmentPerHouse"=334,
        "snapshotAt"=now(),"termsVersion"=2 WHERE id=$1`,
          [funds[0]],
        );
        for (let i = 0; i < payments.length; i++) {
          await c.query(
            `INSERT INTO "Payment"(id,"fundId","villageId","houseId","fundHouseAssessmentId","payerUserId",amount,"updatedAt")
          VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
            [
              payments[i],
              funds[0],
              villages[0],
              houses[i],
              assessments[i],
              users[i],
              i === 0 ? 1001 : 334,
            ],
          );
          await c.query(
            `INSERT INTO "Receipt"(id,"receiptNumber","paymentId","villageId","updatedAt")
          VALUES ($1,$1,$2,$3,now())`,
            [receipts[i], payments[i], villages[0]],
          );
        }
        await c.query(
          `UPDATE "Payment" SET status='VOIDED',"voidReason"='Report fixture correction' WHERE id=$1`,
          [payments[1]],
        );
        await c.query(`UPDATE "Receipt" SET status='VOIDED' WHERE id=$1`, [
          receipts[1],
        ]);
        // Reader opens a different transaction: fixtures MUST be committed.
        // All production constraints/triggers are enabled during fixture creation.
        await c.query("COMMIT");
      } catch (error) {
        await c.query("ROLLBACK");
        throw error;
      } finally {
        c.release();
      }
      boundary.client = db.prisma;
      boundary.chief = users[0];
      boundary.village = villages[0];
      read = (await import("./fund-report-queries")).getChiefFundReport;
    }, process.env.VFC_RUN_PHASE7_RELEASE === "1" ? 0 : 20_000);

    afterEach(() => vi.restoreAllMocks());
    afterAll(async () => {
      const cleanup = async () => {
        vi.restoreAllMocks();
        boundary.client = null;
        await sandbox?.dispose();
      };
      if (process.env.VFC_RUN_PHASE7_RELEASE === "1") {
        await trackReleaseLifecycle(() => finishReleaseSetup(setup, cleanup));
      } else await cleanup();
    }, process.env.VFC_RUN_PHASE7_RELEASE === "1" ? 0 : 120_000);

    type Tx = Prisma.TransactionClient;
    type Body = (tx: Tx) => Promise<unknown>;
    type Options = {
      isolationLevel?: Prisma.TransactionIsolationLevel;
      maxWait?: number;
      timeout?: number;
    };
    // Observation/barriers only: every operation runs against the real transaction.
    function instrument(
      hook: (
        tx: Tx,
        operation: string,
        proceed: () => Promise<unknown>,
      ) => Promise<unknown>,
    ) {
      const original = db.prisma.$transaction.bind(db.prisma);
      return vi.spyOn(db.prisma, "$transaction").mockImplementation((async (
        body: Body,
        options?: Options,
      ) =>
        original(
          async (tx: Tx) =>
            body(
              new Proxy(tx, {
                get(target, key) {
                  const value = Reflect.get(target, key);
                  if (typeof value === "function")
                    return (...args: unknown[]) =>
                      hook(
                        tx,
                        key === "$executeRaw"
                          ? `${String(key)}:${String(args[0])}`
                          : String(key),
                        async () => Reflect.apply(value, target, args),
                      );
                  if (
                    ["user", "fund", "fundHouseAssessment", "payment"].includes(
                      String(key),
                    )
                  ) {
                    return new Proxy(value, {
                      get(delegate, method) {
                        const query = Reflect.get(delegate, method);
                        return typeof query === "function"
                          ? (...args: unknown[]) =>
                              hook(
                                tx,
                                `${String(key)}.${String(method)}`,
                                async () =>
                                  Reflect.apply(query, delegate, args),
                              )
                          : query;
                      },
                    });
                  }
                  return value;
                },
              }),
            ),
          options,
        )) as typeof db.prisma.$transaction);
    }
    function latch() {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { promise, release };
    }
    async function bounded<T>(promise: Promise<T>, ms = 10_000): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          promise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Test synchronization deadline exceeded")),
              ms,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    const outcome = (promise: Promise<unknown>) =>
      promise.then(
        (value) => ({ value, error: undefined }),
        (error: unknown) => ({ value: undefined, error }),
      );
    async function assertConnectionsReleased() {
      const deadline = Date.now() + 5000;
      while (
        db.pool.waitingCount !== 0 ||
        db.pool.idleCount !== db.pool.totalCount
      ) {
        if (Date.now() > deadline)
          throw new Error(
            "Reader leaked a pool connection or pending acquisition",
          );
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      const active = await db.pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
      FROM pg_stat_activity WHERE datname=current_database() AND application_name=$1
      AND state LIKE 'idle in transaction%'`,
        [sandbox!.applicationName],
      );
      expect(active.rows[0].count).toBe(0);
    }
    async function addPayment(c: import("pg").PoolClient, index: number) {
      const payment = uid(),
        receipt = uid();
      payments.push(payment);
      receipts.push(receipt);
      await c.query(
        `INSERT INTO "Payment"(id,"fundId","villageId","houseId","fundHouseAssessmentId","payerUserId",amount,"updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,334,now())`,
        [
          payment,
          funds[0],
          villages[0],
          houses[index],
          assessments[index],
          users[index],
        ],
      );
      await c.query(
        `INSERT INTO "Receipt"(id,"receiptNumber","paymentId","villageId","updatedAt")
      VALUES ($1,$1,$2,$3,now())`,
        [receipt, payment, villages[0]],
      );
    }

    it("computes exact committed metrics, excluding voided money and coverage", async () => {
      const report = await read(funds[0]);
      expect(report.fund.status).toBe("ACTIVE");
      expect(report.metrics).toMatchObject({
        expectedHouseholdAssessmentTotal: 1002,
        acceptedCollectionAmount: 1001,
        outstandingHouseholdObligations: 668,
        remainingVillageTarget: 0,
        excessCollectionOverVillageTarget: 0,
        roundingSurplus: 1,
        paidFrozenAssessmentCount: 1,
        unpaidFrozenAssessmentCount: 2,
        isComplete: false,
      });
      expect(report.metrics?.acceptedCollectionAmount).toBe(1001);
    });

    it("paginates display rows without truncating whole-fund metrics", async () => {
      const page1 = await read(funds[0], { page: 1, pageSize: 2 });
      const page2 = await read(funds[0], { page: 2, pageSize: 2 });
      expect(page1.assessmentPage.rows).toHaveLength(2);
      expect(page2.assessmentPage.rows).toHaveLength(1);
      expect(page1.metrics).toEqual(page2.metrics);
      expect(page1.assessmentPage.total).toBe(3);
      expect(page1.assessmentPage.totalPages).toBe(2);
    });

    it("does not fabricate a snapshot for a DRAFT fund", async () => {
      const report = await read(funds[1]);
      expect(report.fund.status).toBe("DRAFT");
      expect(report.metrics).toMatchObject({
        villageTargetAmount: 1001,
        acceptedCollectionAmount: 0,
        remainingVillageTarget: 1001,
        excessCollectionOverVillageTarget: 0,
        hasFrozenAssessments: false,
        expectedHouseholdAssessmentTotal: null,
        roundingSurplus: null,
        outstandingHouseholdObligations: null,
        paidFrozenAssessmentCount: null,
        unpaidFrozenAssessmentCount: null,
        isComplete: false,
      });
      expect(report.assessmentPage.total).toBe(0);
    });

    it("returns identical not-found errors for foreign and missing funds", async () => {
      const foreign = await outcome(read(funds[2]));
      const missing = await outcome(read(uid()));
      expect(foreign.error).toBeDefined();
      expect(missing.error).toBeDefined();
      expect((foreign.error as { digest?: string }).digest).toBe(
        "NEXT_HTTP_ERROR_FALLBACK;404",
      );
      expect((missing.error as { digest?: string }).digest).toBe(
        "NEXT_HTTP_ERROR_FALLBACK;404",
      );
    });

    it("uses Repeatable Read and issues READ ONLY before data reads", async () => {
      const operations: string[] = [];
      const settings: Array<Record<string, string>> = [];
      const spy = instrument(async (tx, operation, proceed) => {
        operations.push(operation);
        const result = await proceed();
        if (operation === "payment.findMany") {
          const rows = await tx.$queryRaw<
            Array<{ isolation: string; read_only: string; database: string }>
          >`SELECT current_setting('transaction_isolation') AS isolation,
            current_setting('transaction_read_only') AS read_only,
            current_database() AS database`;
          settings.push(rows[0]);
        }
        return result;
      });
      await read(funds[0]);
      spy.mockRestore();
      expect(settings).toHaveLength(1);
      expect(settings[0]).toMatchObject({
        isolation: "repeatable read",
        read_only: "on",
        database: "vfc_test",
      });
      expect(operations.indexOf("$executeRaw:SET TRANSACTION READ ONLY")).toBe(
        0,
      );
      expect(operations.indexOf("user.findUnique")).toBeGreaterThan(
        operations.indexOf("$executeRaw:SET TRANSACTION READ ONLY"),
      );
      expect(operations.indexOf("fund.findFirst")).toBeGreaterThan(
        operations.indexOf("user.findUnique"),
      );
      expect(
        operations.indexOf("fundHouseAssessment.findMany"),
      ).toBeGreaterThan(operations.indexOf("fund.findFirst"));
      expect(operations.indexOf("payment.findMany")).toBeGreaterThan(
        operations.indexOf("fundHouseAssessment.findMany"),
      );
      await assertConnectionsReleased();
    });

    it("keeps the earlier payment snapshot while a second connection commits a correction", async () => {
      const paused = latch();
      const resume = latch();
      const spy = instrument(async (tx, operation, proceed) => {
        const result = await proceed();
        if (operation === "fund.findFirst") {
          paused.release();
          await resume.promise;
        }
        return result;
      });
      const pending = read(funds[0]);
      await bounded(paused.promise);
      const c = await db.pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(
          `UPDATE "Payment" SET status='VOIDED',"voidReason"='Concurrent correction' WHERE id=$1`,
          [payments[0]],
        );
        await c.query(`UPDATE "Receipt" SET status='VOIDED' WHERE id=$1`, [
          receipts[0],
        ]);
        await addPayment(c, 0);
        await c.query("COMMIT");
      } catch (error) {
        await c.query("ROLLBACK");
        throw error;
      } finally {
        c.release();
      }
      resume.release();
      const report = await bounded(pending);
      spy.mockRestore();
      expect(report.metrics).toMatchObject({
        acceptedCollectionAmount: 1001,
        paidFrozenAssessmentCount: 1,
        unpaidFrozenAssessmentCount: 2,
      });
      await assertConnectionsReleased();
      const fresh = await read(funds[0]);
      expect(fresh.metrics).toMatchObject({
        acceptedCollectionAmount: 334,
        remainingVillageTarget: 667,
      });
    });

    it("rejects a real write inside the reader transaction with SQLSTATE 25006", async () => {
      let sqlState: string | undefined;
      const spy = instrument(async (tx, operation, proceed) => {
        const result = await proceed();
        if (operation === "fund.findFirst") {
          await tx.$executeRawUnsafe(`SAVEPOINT report_write_probe`);
          try {
            await tx.$executeRawUnsafe(
              `UPDATE "Fund" SET name = 'write probe' WHERE id = $1`,
              funds[0],
            );
          } catch (error) {
            const prismaError = error as {
              code?: string;
              meta?: {
                driverAdapterError?: {
                  cause?: {
                    code?: string;
                  };
                };
              };
            };

            sqlState =
              prismaError.meta?.driverAdapterError?.cause?.code ??
              prismaError.code;
            await tx.$executeRawUnsafe(
              `ROLLBACK TO SAVEPOINT report_write_probe`,
            );
          }
        }
        return result;
      });
      const report = await read(funds[0]);
      spy.mockRestore();
      expect(sqlState).toBe("25006");
      expect(report.fund.id).toBe(funds[0]);
      await assertConnectionsReleased();
    });

    it("times out acquiring a saturated connection pool and releases pending acquisition", async () => {
      const leases: import("pg").PoolClient[] = [];
      try {
        const max = db.pool.options.max;
        if (!max) throw new Error("Cannot determine pool capacity");
        for (let i = 0; i < max; i++) leases.push(await db.pool.connect());
        const start = Date.now();
        const failure = await bounded(outcome(read(funds[0])), 7000);
        expect(inspectDatabaseError(failure.error).prismaCodes).toContain(
          "P2028",
        );
        expect(Date.now() - start).toBeGreaterThanOrEqual(1500);
        expect(Date.now() - start).toBeLessThan(6500);
      } finally {
        leases.forEach((lease) => lease.release());
      }
      await assertConnectionsReleased();
      expect((await bounded(read(funds[0]))).fund.id).toBe(funds[0]);
    }, 20_000);

    it("expires the real transaction during a slow PostgreSQL query and releases it", async () => {
      const spy = instrument(async (tx, operation, proceed) => {
        const result = await proceed();
        if (operation === "$executeRaw:SET TRANSACTION READ ONLY")
          await tx.$queryRaw`SELECT 1 FROM pg_sleep(6)`;
        return result;
      });
      const start = Date.now();
      const failure = await bounded(outcome(read(funds[0])), 12_000);
      expect(inspectDatabaseError(failure.error).prismaCodes).toContain(
        "P2028",
      );
      expect(Date.now() - start).toBeGreaterThanOrEqual(4500);
      spy.mockRestore();
      await assertConnectionsReleased();
      expect((await bounded(read(funds[0]))).fund.id).toBe(funds[0]);
    }, 20_000);

    it("reports a CLOSED fund after every frozen assessment has accepted coverage", async () => {
      const c = await db.pool.connect();
      try {
        await c.query("BEGIN");
        await addPayment(c, 1);
        await addPayment(c, 2);
        await c.query(
          `UPDATE "Fund" SET status='CLOSED',"closedAt"=now(),"closedByUserId"=$2,
        "termsVersion"="termsVersion"+1 WHERE id=$1`,
          [funds[0], users[0]],
        );
        await c.query("COMMIT");
      } catch (error) {
        await c.query("ROLLBACK");
        throw error;
      } finally {
        c.release();
      }
      const report = await read(funds[0]);
      expect(report.fund.status).toBe("CLOSED");
      expect(report.metrics).toMatchObject({
        isComplete: true,
        expectedHouseholdAssessmentTotal: 1002,
        acceptedCollectionAmount: 1669,
        outstandingHouseholdObligations: 0,
        paidFrozenAssessmentCount: 3,
        unpaidFrozenAssessmentCount: 0,
        excessCollectionOverVillageTarget: 668,
      });
    });

    it("rejects unpaid closure with constraints enabled and rolls back lifecycle/audit writes", async () => {
      const id = funds[0];
      const before = await db.prisma.fund.findUniqueOrThrow({ where: { id } });
      const payments = await db.prisma.payment.findMany({ where: { fundId: id }, orderBy: { id: "asc" } });
      const receipts = await db.prisma.receipt.findMany({ where: { payment: { fundId: id } }, orderBy: { id: "asc" } });
      const audits = await db.prisma.auditLog.count({ where: { fundId: id } });
      const c = await db.pool.connect();
      try {
        await c.query("BEGIN");
        await c.query(`UPDATE "Fund" SET status='CLOSED',"closedAt"=now(),"closedByUserId"=$2,
          "termsVersion"="termsVersion"+1 WHERE id=$1`, [id, users[0]]);
        await expect(c.query("SET CONSTRAINTS ALL IMMEDIATE")).rejects.toMatchObject({
          code: "P0001", message: expect.stringContaining("VFC_SNAPSHOT_OR_CLOSURE_INVALID"),
        });
      } finally { try { await c.query("ROLLBACK"); } finally { c.release(); } }
      expect(await db.prisma.fund.findUniqueOrThrow({ where: { id } })).toEqual(before);
      expect(await db.prisma.payment.findMany({ where: { fundId: id }, orderBy: { id: "asc" } })).toEqual(payments);
      expect(await db.prisma.receipt.findMany({ where: { payment: { fundId: id } }, orderBy: { id: "asc" } })).toEqual(receipts);
      expect(await db.prisma.auditLog.count({ where: { fundId: id } })).toBe(audits);
      expect((await read(id)).fund.status).toBe("ACTIVE");
      await assertConnectionsReleased();
    }, 20_000);
  },
);
