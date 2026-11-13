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
  "fund report reader (owned PostgreSQL)",
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

    beforeAll(async () => {
      const { startReportPostgresSandbox } = await import(
        "@/test-support/report-postgres-sandbox"
      );
      sandbox = await startReportPostgresSandbox();
      db = sandbox.db;
    }, 120_000);
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
    }, 20_000);

    afterEach(() => vi.restoreAllMocks());
    afterAll(async () => {
      vi.restoreAllMocks();
      boundary.client = null;
      await sandbox?.dispose();
    }, 40_000);

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
      const active = await db.pool.query<{
        count: number;
      }>(`SELECT count(*)::int AS count
      FROM pg_stat_activity WHERE datname=current_database() AND state LIKE 'idle in transaction%'`);
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
      expect(report.metrics).toEqual({
        villageTargetAmount: 1001,
        expectedHouseholdAssessmentTotal: 1002,
        roundingSurplus: 1,
        acceptedCollectionAmount: 1001,
        remainingVillageTarget: 0,
        excessCollectionOverVillageTarget: 0,
        outstandingHouseholdObligations: 668,
        paidFrozenAssessmentCount: 1,
        unpaidFrozenAssessmentCount: 2,
        hasFrozenAssessments: true,
        isComplete: false,
      });
      expect(report.assessmentPage.rows).toEqual([
        expect.objectContaining({
          id: assessments[0],
          paid: true,
          acceptedCollectionAmount: 1001,
        }),
        expect.objectContaining({
          id: assessments[1],
          paid: false,
          acceptedCollectionAmount: 0,
        }),
        expect.objectContaining({
          id: assessments[2],
          paid: false,
          acceptedCollectionAmount: 0,
        }),
      ]);
    });

    it("paginates display without truncating metrics", async () => {
      const full = await read(funds[0]);
      const page = await read(funds[0], { page: 2, pageSize: 1 });
      expect(page.metrics).toEqual(full.metrics);
      expect(page.assessmentPage).toMatchObject({
        page: 2,
        pageSize: 1,
        total: 3,
        totalPages: 3,
      });
      expect(page.assessmentPage.rows).toEqual([full.assessmentPage.rows[1]]);
    });

    it("does not fabricate a DRAFT snapshot", async () => {
      const report = await read(funds[1]);
      expect(report.metrics).toMatchObject({
        hasFrozenAssessments: false,
        expectedHouseholdAssessmentTotal: null,
        acceptedCollectionAmount: 0,
        outstandingHouseholdObligations: null,
        isComplete: false,
      });
      expect(report.assessmentPage.rows).toEqual([]);
    });

    it("returns identical not-found errors for foreign and nonexistent funds", async () => {
      // Real Next navigation errors: no navigation or query mocks.
      const foreign = await read(funds[2]).catch((error: unknown) => error);
      const missing = await read(uid()).catch((error: unknown) => error);
      expect(foreign).toBeInstanceOf(Error);
      expect(foreign).toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
      expect(missing).toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
      expect((foreign as Error).message).toBe((missing as Error).message);
    });

    it("uses Repeatable Read and issues READ ONLY before data reads", async () => {
      const operations: string[] = [];
      let settings: {
        isolation: string;
        readOnly: string;
        database: string;
      }[] = [];
      const spy = instrument(async (tx, operation, proceed) => {
        operations.push(operation);
        const result = await proceed();
        if (operation === "$executeRaw:SET TRANSACTION READ ONLY") {
          settings = await tx.$queryRaw`SELECT current_database() AS database,
          current_setting('transaction_isolation') AS isolation,
          current_setting('transaction_read_only') AS "readOnly"`;
        }
        return result;
      });
      await read(funds[0]);
      expect(spy).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: "RepeatableRead",
        maxWait: 2000,
        timeout: 5000,
      });
      expect(operations).toEqual([
        "$executeRaw:SET TRANSACTION READ ONLY",
        "user.findUnique",
        "fund.findFirst",
        "fundHouseAssessment.findMany",
        "payment.findMany",
      ]);
      expect(settings).toEqual([
        { database: "vfc_test", isolation: "repeatable read", readOnly: "on" },
      ]);
    });

    it("keeps the earlier payment snapshot while a second connection commits a correction", async () => {
      const reached = latch(),
        resume = latch();
      const spy = instrument(async (_tx, operation, proceed) => {
        const result = await proceed();
        if (operation === "fund.findFirst") {
          reached.release();
          await bounded(resume.promise, 4000);
        }
        return result;
      });
      const pending = outcome(read(funds[0]));
      try {
        await bounded(reached.promise, 4000);
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
      } finally {
        resume.release();
      }
      const before = await bounded(pending);
      expect(before.error).toBeUndefined();
      expect(before.value).toMatchObject({
        metrics: {
          acceptedCollectionAmount: 1001,
          paidFrozenAssessmentCount: 1,
        },
      });
      spy.mockRestore();
      expect((await read(funds[0])).metrics).toMatchObject({
        acceptedCollectionAmount: 334,
        remainingVillageTarget: 667,
      });
      await assertConnectionsReleased();
    }, 15_000);

    it("rejects a real write with SQLSTATE 25006 and recovers via savepoint", async () => {
      let rejected = false;
      instrument(async (tx, operation, proceed) => {
        const result = await proceed();
        if (operation === "user.findUnique") {
          await tx.$executeRawUnsafe("SAVEPOINT report_write_probe");
          try {
            const failure = await outcome(
              tx.$executeRawUnsafe(
                'UPDATE "Fund" SET name=name WHERE id=$1',
                funds[0],
              ),
            );
            expect(inspectDatabaseError(failure.error).sqlStates).toContain(
              "25006",
            );
            rejected = true;
          } finally {
            await tx.$executeRawUnsafe(
              "ROLLBACK TO SAVEPOINT report_write_probe",
            );
            await tx.$executeRawUnsafe("RELEASE SAVEPOINT report_write_probe");
          }
        }
        return result;
      });
      await read(funds[0]);
      expect(rejected).toBe(true);
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
  },
);
