/** Authored release gate; never run here. Real two-Village recording actions,
 * authorization, allocator, retries, audit and constraints. Only verified-cookie
 * claims, preflight and Prisma request routing are controlled boundaries. */
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it, vi } from "vitest";
import type { Client } from "pg";
import { disposable, migration } from "@/features/fund-management/lib/fund-migration-test-support";
import { activate } from "@/features/fund-management/lib/fund-schema-test-support";
import { getCurrentPeriod } from "@/lib/authz/collector-period";
import { inspectDatabaseError } from "@/lib/db/database-errors";
interface RequestContext {
  client: PrismaClient;
  villageId: string;
  actorId: string;
  pid?: number;
  onAllocator?: () => void;
  beforeCommit?: () => Promise<void>;
}
const boundary = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  return { request: new AsyncLocalStorage<RequestContext>() };
});
function context() {
  const value = boundary.request.getStore();
  if (!value) throw new Error("Missing test request context");
  return value;
}
vi.mock("@/lib/authz", () => ({ requireActiveCollector: async () => ({ villageId: context().villageId }) }));
vi.mock("@/lib/auth/session-identity", () => ({ getSessionIdentity: async () => ({ userId: context().actorId, sessionVersion: 0 }) }));
vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get(_target, key) {
  const request = context(), client = request.client;
  if (key === "$transaction") return (body: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => client.$transaction(async (real) => {
    const [backend] = await real.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    request.pid = backend.pid;
    const tx = new Proxy(real, { get(target, method) {
      if (method === "$queryRaw") return (...args: unknown[]) => {
        // Observe the real allocator call without changing SQL, lock semantics,
        // amounts, errors or transaction outcomes. Repeated on actual retries.
        if (Array.isArray(args[0]) && String(args[0]).includes("pg_advisory_xact_lock")) request.onAllocator?.();
        return Reflect.apply(target.$queryRaw, target, args);
      };
      const value = Reflect.get(target, method); return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await body(tx); await request.beforeCommit?.(); return result;
  }, { ...options, timeout: 20000 });
  const value = Reflect.get(client, key); return typeof value === "function" ? value.bind(client) : value;
} }) }));
import { recordCashPaymentAction } from "./record-cash-payment.action";
const enabled = Boolean(process.env.TEST_DATABASE_URL) && process.env.VFC_ALLOW_MIGRATION_TESTS === "1";
function gate() { let open!: () => void; const reached = new Promise<void>((resolve) => { open = resolve; }); return { open, reached }; }
function observe<T>(operation: Promise<T>) { return operation.then((value) => ({ value }), (error: unknown) => ({ error })); }
async function reach<T>(barrier: ReturnType<typeof gate>, operation: ReturnType<typeof observe<T>>) {
  await Promise.race([barrier.reached, operation.then((out) => { if ("error" in out) throw out.error; throw new Error("Action ended before barrier"); })]);
}
async function advisoryBlocked(raw: Client, blockedPid: number, holderPid: number, signal: AbortSignal) {
  // A bounded database-observation barrier, not a timing-only sleep. Releasing
  // the holder is forbidden until PostgreSQL confirms this exact dependency.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (signal.aborted) return;
    const result = await raw.query<{ blocked: boolean }>(`SELECT EXISTS (
      SELECT 1 FROM pg_locks WHERE pid=$1 AND locktype='advisory' AND NOT granted
    ) AND $2::int=ANY(pg_blocking_pids($1::int)) AS blocked`, [blockedPid, holderPid]);
    if (result.rows[0].blocked) return;
  }
  throw new Error("Second payment never waited on the first payment's advisory lock");
}
function form(id: string) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ fundId: id, termsVersion: "2", houseId: id, payerUserId: `head-${id}`, amount: "1001" })) data.set(key, value);
  return data;
}
describe.skipIf(!enabled)("two-Village receipt allocator release gate", () => {
  it("commits both real actions with distinct receipts and exactly two linked audits each", async () => {
    await disposable(async (raw, url) => {
      await raw.query(await migration());
      for (const id of ["a", "b"]) {
        await raw.query(`INSERT INTO "Village"(id,"villageCode",name,"updatedAt") VALUES ($1,$1,'Test',now());`, [id]);
        await raw.query(`INSERT INTO "House"(id,"villageId","houseNumber","updatedAt") VALUES ($1,$1,'H1',now())`, [id]);
        await raw.query(`INSERT INTO "User"(id,"villageId","houseId",role,"membershipStatus",name,"passwordHash","updatedAt") VALUES
          ($2,$1,$1,'VILLAGER','ACTIVE','Head','unused',now()),($3,$1,$1,'VILLAGER','ACTIVE','Collector','unused',now())`, [id, `head-${id}`, `collector-${id}`]);
        await raw.query(`UPDATE "House" SET "headOfHouseId"=$2 WHERE id=$1`, [id, `head-${id}`]);
        await raw.query(`INSERT INTO "CollectorAssignment"(id,"villageId","userId",year,month,"updatedAt") VALUES ($1,$1,$2,$3,$4,now())`, [id, `collector-${id}`, getCurrentPeriod().year, getCurrentPeriod().month]);
        await raw.query(`INSERT INTO "Fund"(id,"villageId",name,"villageTargetAmount","startDate","endDate","updatedAt") VALUES ($1,$1,'Fund',1001,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date-1,(clock_timestamp() AT TIME ZONE 'Asia/Yangon')::date+1,now())`, [id]);
        await raw.query("BEGIN"); await activate(raw, id); await raw.query("COMMIT");
      }
      const clients = [new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }), new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })];
      const written = gate(), release = gate(), allocating = gate();
      const firstContext: RequestContext = { client: clients[0], villageId: "a", actorId: "collector-a", beforeCommit: async () => { written.open(); await release.reached; } };
      const secondContext: RequestContext = { client: clients[1], villageId: "b", actorId: "collector-b", onAllocator: allocating.open };
      let first: ReturnType<typeof observe<Awaited<ReturnType<typeof recordCashPaymentAction>>>> | undefined;
      let second: typeof first;
      const observationAbort = new AbortController();
      let observation: ReturnType<typeof observe<void>> | undefined;
      let failed = false;
      try {
        first = observe(boundary.request.run(firstContext, () => recordCashPaymentAction(form("a"))));
        await reach(written, first);
        second = observe(boundary.request.run(secondContext, () => recordCashPaymentAction(form("b"))));
        await reach(allocating, second);
        expect(firstContext.pid).toBeDefined(); expect(secondContext.pid).toBeDefined(); expect(secondContext.pid).not.toBe(firstContext.pid);
        observation = observe(advisoryBlocked(raw, secondContext.pid!, firstContext.pid!, observationAbort.signal));
        await Promise.race([observation.then((out) => { if ("error" in out) throw out.error; }), second.then((out) => { if ("error" in out) throw out.error; throw new Error("Second payment completed without advisory contention"); })]);
        release.open();
        const results = await Promise.all([first, second]);
        // No arbitrary exception/P2002 is an accepted outcome. Report structured
        // diagnostics if this gate fails; allocator changes need separate review.
        expect(results.map((out) => "error" in out ? { error: inspectDatabaseError(out.error) } : out)).toEqual([{ value: { success: true } }, { value: { success: true } }]);
        const payments = await clients[0].payment.findMany({ include: { receipt: true }, orderBy: { villageId: "asc" } });
        expect(payments).toHaveLength(2); expect(await clients[0].receipt.count()).toBe(2);
        expect(new Set(payments.map((p) => p.receipt!.receiptNumber)).size).toBe(2);
        for (const payment of payments) {
          expect(payment).toMatchObject({ villageId: payment.fundId, houseId: payment.fundId, fundHouseAssessmentId: payment.fundId, collectorUserId: `collector-${payment.villageId}`, status: "ACCEPTED" });
          expect(payment.receipt).toMatchObject({ villageId: payment.villageId, paymentId: payment.id, status: "ACTIVE" });
          const audits = await clients[0].auditLog.findMany({ where: { fundId: payment.fundId } });
          expect(audits).toHaveLength(2);
          expect(audits).toEqual(expect.arrayContaining([
            expect.objectContaining({ actorUserId: `collector-${payment.villageId}`, villageId: payment.villageId, entityId: payment.id, metadata: expect.objectContaining({ event: "PAYMENT_CREATED" }) }),
            expect.objectContaining({ actorUserId: `collector-${payment.villageId}`, villageId: payment.villageId, entityId: payment.receipt!.id, metadata: expect.objectContaining({ event: "RECEIPT_CREATED", paymentId: payment.id }) }),
          ]));
        }
        expect(await clients[0].auditLog.count()).toBe(4);
      } catch (error) { failed = true; throw error; }
      finally {
        release.open(); observationAbort.abort(); await observation; await first; await second;
        const cleanup = await Promise.allSettled(clients.map((client) => client.$disconnect()));
        for (const out of cleanup) if (out.status === "rejected") { if (!failed) throw out.reason; console.error("Allocator fixture cleanup failed", out.reason); }
      }
    });
  }, 90000);
});
