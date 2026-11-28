import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

import type { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_COOKIE_NAME } from "@/lib/auth/auth.constants";
import { hashThrottleKey } from "@/lib/auth/login-throttle";
import { hashPassword } from "@/lib/auth/password";
import { createSession, revokeUserSessions } from "@/lib/auth/session";
import { openTestDatabase, type TestDatabase } from "@/test-support/test-database";

import { rejectRecoveryRequestAction, withdrawRecoveryCodeAction } from "../actions/decide-recovery-request.action";
import { issueRecoveryCodeAction } from "../actions/issue-recovery-code.action";
import { hashRecoveryCode } from "./recovery-code";

type Tx = Prisma.TransactionClient;
type TransactionOptions = { isolationLevel?: Prisma.TransactionIsolationLevel };
type TransactionCallback<T> = (tx: Tx) => Promise<T>;

const boundary = vi.hoisted(() => ({
  client: null as PrismaClient | null,
  token: "",
  transaction: vi.fn(),
}));

// The browser/request boundary is simulated. JWT verification, action guards,
// password checks, throttling, retries, decisions and audits use the real code.
vi.mock("next/headers", () => ({
  headers: () => new Headers({ host: "vfc.test", origin: "https://vfc.test" }),
  cookies: () => ({
    get: (name: string) =>
      name === AUTH_COOKIE_NAME && boundary.token ? { value: boundary.token } : undefined,
    set: (name: string, token: string) => {
      if (name === AUTH_COOKIE_NAME) boundary.token = token;
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (location: string) => { throw new Error(`REDIRECT:${location}`); },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get(_target, property) {
      if (property === "$transaction") return boundary.transaction;
      const client = boundary.client;
      if (!client) throw new Error("Test database not initialized");
      const member: unknown = Reflect.get(client, property);
      return typeof member === "function" ? member.bind(client) : member;
    },
  }),
}));

const secret = "fixture-only-recovery-approver-session-secret";
const password = "fixture-approver-password";
const version = 7;
const decisions = ["issue", "reissue", "reject", "withdraw"] as const;
type Decision = (typeof decisions)[number];

async function backendPid(tx: Tx) {
  const [row] = await tx.$queryRaw<[{ pid: number }]>`SELECT pg_backend_pid() AS pid`;
  return row.pid;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("recovery approver session (PostgreSQL)", () => {
  let db: TestDatabase;
  let actorId: string;
  let targetId: string;
  let villageId: string | null;
  let transferVillageId: string | undefined;
  let requestId: string | undefined;
  let passwordHash: string;

  beforeAll(async () => {
    db = await openTestDatabase(process.env, { max: 4 });
    boundary.client = db.prisma;
    vi.stubEnv("AUTH_SECRET", secret);
    passwordHash = await hashPassword(password);
  });

  beforeEach(async () => {
    actorId = `a-approver-${randomUUID()}`;
    targetId = `z-target-${randomUUID()}`;
    villageId = null;
    transferVillageId = undefined;
    requestId = undefined;
    boundary.token = "";
    observeDecisions({});
    await db.prisma.user.createMany({ data: [
      { id: actorId, name: "Approver", role: "SYSTEM_ADMIN", passwordHash, sessionVersion: version },
      { id: targetId, name: "Recovery target", role: "SYSTEM_ADMIN", passwordHash },
    ] });
    expect(await createSession(actorId, version)).toBe(true);
  });

  afterEach(async () => {
    if (!db || !actorId || !targetId) return;
    await db.prisma.loginThrottleState.deleteMany({ where: { keyHash: stepUpKey() } });
    if (requestId) {
      await db.prisma.notification.deleteMany({ where: { recoveryRequestId: requestId } });
      await db.prisma.auditLog.deleteMany({ where: { entityId: requestId } });
      await db.prisma.passwordRecoveryRequest.deleteMany({ where: { id: requestId } });
    }
    await db.prisma.user.deleteMany({ where: { id: { in: [actorId, targetId] } } });
    if (villageId) await db.prisma.village.delete({ where: { id: villageId } });
    if (transferVillageId) await db.prisma.village.delete({ where: { id: transferVillageId } });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await db?.close();
  });

  function observeDecisions(hooks: {
    before?: () => Promise<void>;
    entered?: (tx: Tx) => Promise<void>;
    finished?: (tx: Tx) => Promise<void>;
  }) {
    let attempts = 0;
    boundary.transaction.mockImplementation(async <T>(run: TransactionCallback<T>, options: TransactionOptions = {}) => {
      const isDecision = options.isolationLevel === "Serializable";
      if (isDecision && ++attempts === 1) await hooks.before?.();
      return db.prisma.$transaction(async (tx) => {
        if (isDecision) await hooks.entered?.(tx);
        const result = await run(tx);
        if (isDecision) await hooks.finished?.(tx);
        return result;
      }, { ...options, timeout: 15_000 });
    });
    return () => attempts;
  }

  async function makeRequest(decision: Decision) {
    const id = `request-${randomUUID()}`;
    const issued = decision === "reissue" || decision === "withdraw";
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 3_600_000);
    const row = await db.prisma.passwordRecoveryRequest.create({
      data: {
        id,
        userId: targetId,
        villageId,
        requestExpiresAt: expiresAt,
        ...(issued ? {
          status: "CODE_ISSUED",
          codeIssuedAt: now,
          codeExpiresAt: expiresAt,
          codeIssuedByUserId: actorId,
          codeHash: hashRecoveryCode(secret, id, "ABCDEFGH"),
          issueCount: 1,
        } : {}),
      },
    });
    requestId = row.id;
    return row;
  }

  async function makeChief() {
    const village = await db.prisma.village.create({
      data: { name: "Recovery village", villageCode: `A02-${randomUUID()}` },
    });
    villageId = village.id;
    await db.prisma.user.update({
      where: { id: actorId },
      data: { role: "CHIEF", villageId, membershipStatus: "ACTIVE" },
    });
    await db.prisma.user.update({
      where: { id: targetId },
      data: { role: "VILLAGER", villageId, membershipStatus: "ACTIVE" },
    });
  }

  function stepUpKey() {
    return hashThrottleKey(secret, "RECOVERY_STEPUP_ACCOUNT", `user:${actorId}`);
  }

  function state(id: string) {
    return db.prisma.passwordRecoveryRequest.findUniqueOrThrow({ where: { id } });
  }

  function requestAudits(id: string) {
    return db.prisma.auditLog.findMany({ where: { entityId: id } });
  }

  async function decide(decision: Decision, id: string, submittedPassword = password) {
    const data = new FormData();
    data.set("requestId", id);
    data.set("password", submittedPassword);
    data.set("note", "Verified test decision");
    // Neither form value may affect the authenticated actor or signed version.
    data.set("actorUserId", targetId);
    data.set("sessionVersion", String(version + 1));
    try {
      switch (decision) {
        case "issue":
        case "reissue":
          return await issueRecoveryCodeAction({ status: "idle" }, data);
        case "reject":
          await rejectRecoveryRequestAction(data);
          break;
        case "withdraw":
          await withdrawRecoveryCodeAction(data);
          break;
      }
      throw new Error("Expected a recovery decision redirect");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("REDIRECT:")) throw error;
      return { location: error.message.slice("REDIRECT:".length) };
    }
  }

  function expectDenied(decision: Decision, outcome: Awaited<ReturnType<typeof decide>>) {
    if (decision === "issue" || decision === "reissue") {
      expect(outcome).toEqual({ status: "error", error: "not_found" });
    } else {
      expect(outcome).toMatchObject({ location: expect.stringMatching(/\?error=not_found$/) });
    }
  }

  async function expectUntouched(original: Awaited<ReturnType<typeof makeRequest>>) {
    expect(await state(original.id)).toEqual(original);
    expect(await requestAudits(original.id)).not.toContainEqual(
      expect.objectContaining({ metadata: expect.objectContaining({ outcome: "SUCCESS" }) }),
    );
    expect(await db.prisma.notification.count({ where: { recoveryRequestId: original.id } })).toBe(0);
  }

  async function expectBlockedBy(waiter: number, holder: number) {
    expect(waiter).not.toBe(holder);
    const until = Date.now() + 5_000;
    while (Date.now() < until) {
      const { rows } = await db.pool.query<{ blocked: boolean }>(
        "SELECT $2::integer = ANY(pg_blocking_pids($1::integer)) AS blocked",
        [waiter, holder],
      );
      if (rows[0]?.blocked) return;
      await setTimeout(10);
    }
    throw new Error("Expected PostgreSQL to report the waiting transaction");
  }

  it("allows a session-backed Chief to issue for their village", async () => {
    await makeChief();
    const request = await makeRequest("issue");

    expect(await decide("issue", request.id)).toMatchObject({ status: "issued", requestId: request.id });
    expect(await state(request.id)).toMatchObject({ status: "CODE_ISSUED", codeIssuedByUserId: actorId });
  });

  it("keeps the existing bad-password audit and attempt counter", async () => {
    const request = await makeRequest("issue");

    expect(await decide("issue", request.id, "fixture-wrong-password"))
      .toEqual({ status: "error", error: "bad_password" });
    await expectUntouched(request);
    expect(await requestAudits(request.id)).toContainEqual(expect.objectContaining({
      actorUserId: actorId, metadata: expect.objectContaining({ event: "STEP_UP_FAILED", outcome: "BLOCKED" }),
    }));
    expect(await db.prisma.loginThrottleState.count({ where: { keyHash: stepUpKey() } })).toBe(1);
  });

  it("refuses a session already revoked at the outer guard", async () => {
    const request = await makeRequest("reject");
    await revokeUserSessions(actorId);

    expect(await decide("reject", request.id)).toEqual({ location: "/login" });
    await expectUntouched(request);
  });

  it("rejects a version change after the signed session and password step-up were verified", async () => {
    const request = await makeRequest("issue");
    observeDecisions({ before: () => revokeUserSessions(actorId) });

    expectDenied("issue", await decide("issue", request.id));
    await expectUntouched(request);
    expect(await db.prisma.loginThrottleState.count({ where: { keyHash: stepUpKey() } })).toBe(1);
  });

  it("requires the exact hash verified by step-up, independently of the version check", async () => {
    const request = await makeRequest("issue");
    const newHash = await hashPassword("fixture-different-password");
    observeDecisions({ before: async () => {
      await db.prisma.user.update({ where: { id: actorId }, data: { passwordHash: newHash } });
    } });

    expectDenied("issue", await decide("issue", request.id));
    await expectUntouched(request);
  });

  it.each(["role", "forced password change", "Chief membership"] as const)(
    "rejects stale authorization after a change to %s",
    async (restriction) => {
      if (restriction === "Chief membership") await makeChief();
      const request = await makeRequest("reject");
      observeDecisions({ before: async () => {
        const data: Prisma.UserUncheckedUpdateInput =
          restriction === "role" ? { role: "VILLAGER" } :
          restriction === "forced password change" ? { mustChangePassword: true } :
          { membershipStatus: "REMOVED" };
        await db.prisma.user.update({ where: { id: actorId }, data });
      } });

      expectDenied("reject", await decide("reject", request.id));
      await expectUntouched(request);
      if (restriction === "role" || restriction === "Chief membership") {
        expect(await requestAudits(request.id)).toContainEqual(expect.objectContaining({
          actorUserId: actorId,
          metadata: expect.objectContaining({ event: "AUTHORITY_REFUSED", outcome: "BLOCKED" }),
        }));
      }
    },
  );

  it.each(["village suspension", "village transfer"] as const)(
    "audits a Chief's denied decision after %s",
    async (change) => {
      await makeChief();
      const request = await makeRequest("reject");
      const originalVillageId = request.villageId;
      if (!originalVillageId) throw new Error("Expected a village recovery request");

      const attempts = observeDecisions({ before: async () => {
        if (change === "village suspension") {
          await db.prisma.village.update({
            where: { id: originalVillageId },
            data: { status: "SUSPENDED" },
          });
        } else {
          const destination = await db.prisma.village.create({
            data: { name: "Transfer village", villageCode: `A02-${randomUUID()}` },
          });
          transferVillageId = destination.id;
          await db.prisma.user.update({
            where: { id: actorId },
            data: { villageId: destination.id },
          });
        }
      } });

      expectDenied("reject", await decide("reject", request.id));
      expect(attempts()).toBe(1);
      await expectUntouched(request);
      expect(await requestAudits(request.id)).toEqual([expect.objectContaining({
        actionType: "REJECT",
        actorUserId: actorId,
        entityType: "PASSWORD_RECOVERY_REQUEST",
        entityId: request.id,
        villageId: originalVillageId,
        metadata: expect.objectContaining({
          event: "AUTHORITY_REFUSED",
          requestId: request.id,
          outcome: "BLOCKED",
          blockReason: "FORBIDDEN",
        }),
      })]);
    },
  );

  it.each(decisions)("refuses stale %s when session revocation commits first", async (decision) => {
    const request = await makeRequest(decision);
    const holder = Promise.withResolvers<number>();
    const waiter = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    const attempts = observeDecisions({ entered: async (tx) => { waiter.resolve(await backendPid(tx)); } });

    const revocation = db.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: actorId }, data: { sessionVersion: { increment: 1 } } });
      holder.resolve(await backendPid(tx));
      await release.promise;
    }, { isolationLevel: "ReadCommitted", timeout: 15_000 });

    let outcome: ReturnType<typeof decide> | undefined;
    try {
      const holderPid = await Promise.race([holder.promise, revocation.then(() => { throw new Error("Revocation did not reach lock"); })]);
      outcome = decide(decision, request.id);
      const waiterPid = await Promise.race([waiter.promise, outcome.then(() => { throw new Error("Decision did not reach lock"); })]);
      await expectBlockedBy(waiterPid, holderPid);
    } finally {
      release.resolve();
      await Promise.all([revocation, outcome]);
    }

    if (!outcome) throw new Error("Expected a decision outcome");
    expectDenied(decision, await outcome);
    expect(attempts()).toBe(2);
    await expectUntouched(request);
  });

  it.each(decisions)("allows %s to commit if it locks the actor first", async (decision) => {
    const request = await makeRequest(decision);
    const holder = Promise.withResolvers<number>();
    const waiter = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    observeDecisions({ finished: async (tx) => {
      holder.resolve(await backendPid(tx));
      await release.promise;
    } });

    const outcome = decide(decision, request.id);
    let revocation: Promise<unknown> | undefined;
    try {
      const holderPid = await Promise.race([holder.promise, outcome.then(() => { throw new Error("Decision did not reach lock"); })]);
      revocation = db.prisma.$transaction(async (tx) => {
        waiter.resolve(await backendPid(tx));
        return tx.user.update({ where: { id: actorId }, data: { sessionVersion: { increment: 1 } } });
      }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
      const waiterPid = await Promise.race([waiter.promise, revocation.then(() => { throw new Error("Revocation did not reach lock"); })]);
      await expectBlockedBy(waiterPid, holderPid);
    } finally {
      release.resolve();
      await Promise.all([outcome, revocation]);
    }

    const result = await outcome;
    if (decision === "issue" || decision === "reissue") {
      expect(result).toMatchObject({ status: "issued", reissued: decision === "reissue" });
      expect(await state(request.id)).toMatchObject({
        status: "CODE_ISSUED", codeIssuedByUserId: actorId, issueCount: request.issueCount + 1,
      });
      expect(await db.prisma.loginThrottleState.count({ where: { keyHash: stepUpKey() } })).toBe(0);
    } else {
      expect(result).toMatchObject({
        location: decision === "reject"
          ? "/admin/password-recovery?notice=rejected"
          : "/admin/password-recovery?notice=withdrawn",
      });
      expect(await state(request.id)).toMatchObject(
        decision === "reject" ? { status: "REJECTED", rejectedByUserId: actorId }
          : { status: "REVOKED", revokedByUserId: actorId, codeHash: null },
      );
      if (decision === "reject") {
        expect(await db.prisma.notification.count({ where: { recoveryRequestId: request.id, type: "RECOVERY_REJECTED" } })).toBe(1);
      }
    }
    expect(await requestAudits(request.id)).toEqual([expect.objectContaining({
      actorUserId: actorId, metadata: expect.objectContaining({ outcome: "SUCCESS" }),
    })]);
    expect(await db.prisma.user.findUnique({ where: { id: actorId } })).toMatchObject({ sessionVersion: version + 1 });
    expect(await decide(decision, request.id)).toEqual({ location: "/login" });
  });
});
