import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { changePasswordAction } from "@/features/user-settings/actions/change-password.action";
import { withSerializableRetry } from "@/lib/db/transaction";
import { openTestDatabase, requireTestDatabaseTarget, type TestDatabase } from "@/test-support/test-database";

import {
  fileRecoveryRequestInTx,
  issueRecoveryCodeInTx,
  redeemRecoveryCodeInTx,
  rejectRecoveryRequestInTx,
  withdrawRecoveryCodeInTx,
} from "./recovery-transitions";
import type { RecoveryRequestInput } from "./recovery-input";

const auth = vi.hoisted(() => ({
  requireSessionUser: vi.fn(),
  identity: vi.fn(),
  destroySession: vi.fn(),
}));
const database = vi.hoisted(() => ({
  readCredential: vi.fn(),
  transaction: vi.fn(),
}));

// Only the signed-in request boundary and transaction observation are
// substituted. The password action and transitions perform real DB writes.
vi.mock("@/lib/auth/guards", () => ({ requireSessionUser: auth.requireSessionUser }));
vi.mock("@/lib/auth/session", () => ({
  getSessionIdentity: auth.identity,
  destroySession: auth.destroySession,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: database.readCredential },
    $transaction: database.transaction,
  },
}));

type Tx = Prisma.TransactionClient;
type Transition<T> = (tx: Tx) => Promise<T>;
type ActionOptions = { isolationLevel: "ReadCommitted" };
type Observation = (tx: Tx) => Promise<void>;

const currentPassword = "fixture-current-password";
const chosenPassword = "fixture-chosen-password";
const seedPassword = "fixture-seed-password";
const codeSecret = "fixture-only-password-recovery-signing-key";
const originalCode = "ABCDEFGH";
const replacementCode = "BCDEFGHJ";

const runProcess = promisify(execFile);

function passwordForm() {
  const data = new FormData();
  data.set("currentPassword", currentPassword);
  data.set("newPassword", chosenPassword);
  data.set("confirmPassword", chosenPassword);
  return data;
}

async function backendPid(tx: Tx) {
  const [row] = await tx.$queryRaw<[{ pid: number }]>`SELECT pg_backend_pid() AS pid`;
  return row.pid;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("credential replacement (PostgreSQL)", () => {
  let db: TestDatabase;
  let userId: string;
  let approverId: string;
  let email: string;
  let input: RecoveryRequestInput;
  let currentHash: string;
  let recoveryHash: string;

  beforeAll(async () => {
    db = await openTestDatabase(process.env, { max: 4 });
    [currentHash, recoveryHash] = await Promise.all([
      bcrypt.hash(currentPassword, 10),
      bcrypt.hash("fixture-recovery-password", 10),
    ]);
  });

  beforeEach(async () => {
    userId = `credential-test-${randomUUID()}`;
    approverId = `credential-test-${randomUUID()}`;
    email = `${userId}@example.test`;
    input = { villageCode: null, identifier: { type: "email", value: email } };
    await db.prisma.user.createMany({ data: [
      { id: userId, name: "Recovery target", email, passwordHash: currentHash, role: "SYSTEM_ADMIN" },
      { id: approverId, name: "Recovery approver", passwordHash: currentHash, role: "SYSTEM_ADMIN" },
    ] });
    vi.resetAllMocks();
    auth.requireSessionUser.mockResolvedValue({ id: userId, villageId: null });
    auth.identity.mockResolvedValue({ userId, sessionVersion: 0 });
    database.readCredential.mockImplementation((args: Prisma.UserFindUniqueArgs) =>
      db.prisma.user.findUnique(args),
    );
    database.transaction.mockImplementation(
      <T>(run: Transition<T>, options: ActionOptions) =>
        db.prisma.$transaction(run, { ...options, timeout: 15_000 }),
    );
  });

  afterEach(async () => {
    const requests = await db.prisma.passwordRecoveryRequest.findMany({
      where: { userId },
      select: { id: true },
    });
    const requestIds = requests.map(({ id }) => id);
    await db.prisma.notification.deleteMany({ where: { recoveryRequestId: { in: requestIds } } });
    await db.prisma.auditLog.deleteMany({
      where: { OR: [{ entityId: { in: [userId, ...requestIds] } }, { actorUserId: { in: [userId, approverId] } }] },
    });
    await db.prisma.passwordRecoveryRequest.deleteMany({ where: { userId } });
    await db.prisma.user.deleteMany({ where: { id: { in: [userId, approverId] } } });
  });

  afterAll(async () => db?.close());

  function recovery<T>(run: Transition<T>, entered?: Observation, finished?: Observation) {
    return withSerializableRetry(() => db.prisma.$transaction(async (tx) => {
      await entered?.(tx);
      const result = await run(tx);
      await finished?.(tx);
      return result;
    }, { isolationLevel: "Serializable", timeout: 15_000 }));
  }

  function issue(tx: Tx, requestId: string, code = originalCode) {
    return issueRecoveryCodeInTx(tx, {
      actorUserId: approverId, requestId, secret: codeSecret, generateCode: () => code,
    });
  }

  async function fileRequest() {
    const filed = await recovery((tx) => fileRecoveryRequestInTx(tx, input));
    if (filed.kind !== "created") throw new Error("Recovery fixture was not filed");
    return filed.requestId;
  }

  async function issueRequest() {
    const requestId = await fileRequest();
    expect(await recovery((tx) => issue(tx, requestId))).toMatchObject({ kind: "issued" });
    return requestId;
  }

  function redeem(tx: Tx, code = originalCode) {
    return redeemRecoveryCodeInTx(tx, { ...input, code, secret: codeSecret, newPasswordHash: recoveryHash });
  }

  function readRequest(id: string) {
    return db.prisma.passwordRecoveryRequest.findUniqueOrThrow({ where: { id } });
  }

  function credential() {
    return db.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { passwordHash: true, sessionVersion: true, mustChangePassword: true },
    });
  }

  function passwordChangeAudits() {
    return db.prisma.auditLog.count({ where: { entityType: "USER", entityId: userId, actionType: "UPDATE" } });
  }

  async function expectRevoked(id: string) {
    expect(await readRequest(id)).toMatchObject({
      status: "REVOKED", revocationReason: "PASSWORD_REPLACED", revokedAt: expect.any(Date), codeHash: null,
    });
  }

  async function expectNoCompletion(id: string) {
    expect(await db.prisma.auditLog.count({ where: { entityId: id, actionType: "COMPLETE" } })).toBe(0);
    expect(await db.prisma.notification.count({
      where: { recoveryRequestId: id, type: "RECOVERY_PASSWORD_CHANGED" },
    })).toBe(0);
  }

  async function runAdminCommand(script: string, args: string[], environment: Record<string, string> = {}) {
    const target = requireTestDatabaseTarget();
    try {
      await runProcess(process.execPath, ["--import", "tsx", script, ...args], {
        env: {
          ...environment,
          PATH: process.env.PATH,
          NODE_ENV: "test",
          DATABASE_URL: target.url,
          DOTENV_CONFIG_PATH: "/dev/null",
        },
        timeout: 10_000,
      });
    } catch {
      throw new Error(`Test subprocess failed for ${script}`);
    }
  }

  function rescue() {
    return runAdminCommand("scripts/reset-admin-password.ts", ["--email", email, "--yes"]);
  }

  /** Observes an actual heavyweight lock wait from a separate database connection. */
  async function expectBlockedBy(waiter: number, holder: number) {
    expect(waiter).not.toBe(holder);
    const until = Date.now() + 5_000;
    while (Date.now() < until) {
      const { rows } = await db.pool.query<{ blocking: boolean }>(
        "SELECT $2::integer = ANY(pg_blocking_pids($1::integer)) AS blocking",
        [waiter, holder],
      );
      if (rows[0]?.blocking) return;
      await setTimeout(10);
    }
    throw new Error("PostgreSQL did not report the waiting transaction blocked by the holder");
  }

  function observeActionTransaction(entered?: Observation, finished?: Observation) {
    database.transaction.mockImplementationOnce(
      <T>(run: Transition<T>, options: ActionOptions) =>
        db.prisma.$transaction(async (tx) => {
          await entered?.(tx);
          const result = await run(tx);
          await finished?.(tx);
          return result;
        }, { ...options, timeout: 15_000 }),
    );
  }

  it("forced change clears the password gate and ends pending recovery", async () => {
    await db.prisma.user.update({ where: { id: userId }, data: { mustChangePassword: true } });
    auth.requireSessionUser.mockResolvedValue({ id: userId, villageId: null, mustChangePassword: true });
    const requestId = await fileRequest();

    expect(await changePasswordAction(passwordForm())).toEqual({ success: true });
    expect(await credential()).toMatchObject({ sessionVersion: 1, mustChangePassword: false });
    expect(auth.destroySession).toHaveBeenCalledOnce();
    await expectRevoked(requestId);
    expect(await recovery((tx) => issue(tx, requestId))).toMatchObject({ kind: "blocked" });
    await expectNoCompletion(requestId);
  });

  it("rolls back the password and version if invalidating an open request fails", async () => {
    const requestId = await issueRequest();
    const before = await credential();
    const invalidation = vi.fn(async (tx: Tx) => {
      expect(await tx.user.findUnique({ where: { id: userId } })).toMatchObject({ sessionVersion: 1 });
      return tx.$queryRaw`SELECT 1 / 0`;
    });
    database.transaction.mockImplementationOnce(
      <T>(run: Transition<T>, options: ActionOptions) =>
        db.prisma.$transaction((tx) => run({
          ...tx,
          passwordRecoveryRequest: {
            ...tx.passwordRecoveryRequest,
            updateManyAndReturn: () => invalidation(tx),
          },
        } as Tx), options),
    );
    expect(await changePasswordAction(passwordForm())).toMatchObject({ success: false });
    expect(invalidation).toHaveBeenCalledOnce();
    expect(await credential()).toEqual(before);
    expect(await readRequest(requestId)).toMatchObject({ status: "CODE_ISSUED" });
    expect(await passwordChangeAudits()).toBe(0);
    expect(auth.destroySession).not.toHaveBeenCalled();
  });

  it("a concurrent self-change succeeds once and audits and destroys the cookie once", async () => {
    const verified = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    database.transaction.mockImplementationOnce(async <T>(run: Transition<T>, options: ActionOptions) => {
      verified.resolve();
      await resume.promise;
      return db.prisma.$transaction(run, options);
    });
    const stale = changePasswordAction(passwordForm());
    try {
      await Promise.race([
        verified.promise,
        stale.then(() => { throw new Error("Self-change did not reach credential transaction"); }),
      ]);
      expect(await changePasswordAction(passwordForm())).toEqual({ success: true });
    } finally {
      resume.resolve();
    }
    expect(await stale).toMatchObject({ success: false });
    expect(await credential()).toMatchObject({ sessionVersion: 1, mustChangePassword: false });
    expect(await passwordChangeAudits()).toBe(1);
    expect(auth.destroySession).toHaveBeenCalledOnce();
  });

  it("a stale self-change leaves the administrative rescue credential and audit authoritative", async () => {
    const requestId = await issueRequest();
    const verified = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    database.transaction.mockImplementationOnce(async <T>(run: Transition<T>, options: ActionOptions) => {
      verified.resolve();
      await resume.promise;
      return db.prisma.$transaction(run, options);
    });

    const stale = changePasswordAction(passwordForm());
    let winningCredential: Awaited<ReturnType<typeof credential>>;
    try {
      await Promise.race([
        verified.promise,
        stale.then(() => { throw new Error("Self-change did not reach credential transaction"); }),
      ]);
      await rescue();
      winningCredential = await credential();
    } finally {
      resume.resolve();
    }
    expect(await stale).toMatchObject({ success: false });
    expect(await credential()).toEqual(winningCredential);
    expect(winningCredential).toMatchObject({ sessionVersion: 1, mustChangePassword: true });
    expect(await passwordChangeAudits()).toBe(0);
    expect(auth.destroySession).not.toHaveBeenCalled();
    await expectRevoked(requestId);
    expect(await db.prisma.auditLog.findFirst({ where: { entityId: requestId, actionType: "COMPLETE" } }))
      .toMatchObject({ metadata: { via: "cli", revocationReason: "PASSWORD_REPLACED" } });
    expect(await recovery((tx) => redeem(tx))).toEqual({ kind: "invalid" });
    expect(await db.prisma.notification.count({ where: { recoveryRequestId: requestId } })).toBe(0);
  });

  it("routine seed preserves valid recovery and explicit seed replacement revokes it without altering history", async () => {
    const historicalId = await fileRequest();
    expect(await recovery((tx) => rejectRecoveryRequestInTx(tx, {
      requestId: historicalId, actorUserId: approverId, note: null,
    }))).toMatchObject({ kind: "rejected" });
    const history = await readRequest(historicalId);
    const requestId = await issueRequest();
    const open = await readRequest(requestId);
    const before = await credential();
    const seedEnvironment = { SEED_ADMIN_EMAIL: email, SEED_ADMIN_PASSWORD: seedPassword };

    await runAdminCommand("prisma/seed.ts", [], seedEnvironment);
    expect(await readRequest(requestId)).toEqual(open);
    expect(await credential()).toEqual(before);

    await runAdminCommand("prisma/seed.ts", [], { ...seedEnvironment, SEED_REPLACE_ADMIN_PASSWORD: "1" });
    await expectRevoked(requestId);
    expect(await readRequest(requestId)).toMatchObject({ codeIssuedByUserId: approverId, issueCount: 1 });
    expect(await readRequest(historicalId)).toEqual(history);
    const replacement = await credential();
    expect(await bcrypt.compare(seedPassword, replacement.passwordHash)).toBe(true);
    expect(replacement.sessionVersion).toBe(1);
    expect(await recovery((tx) => redeem(tx))).toEqual({ kind: "invalid" });
    expect(await credential()).toEqual(replacement);
    await expectNoCompletion(requestId);
  });

  const transitions = ["filing", "issue", "reissue", "reject", "withdraw", "redemption"] as const;
  type Race = (typeof transitions)[number];

  async function prepare(operation: Race): Promise<{ id: string | null; run: Transition<{ kind: string; requestId?: string }> }> {
    if (operation === "filing") {
      return { id: null, run: (tx) => fileRecoveryRequestInTx(tx, input) };
    }
    const id = operation === "issue" || operation === "reject" ? await fileRequest() : await issueRequest();
    switch (operation) {
      case "issue": return { id, run: (tx) => issue(tx, id) };
      case "reissue": return { id, run: (tx) => issue(tx, id, replacementCode) };
      case "reject": return { id, run: (tx) => rejectRecoveryRequestInTx(tx, { requestId: id, actorUserId: approverId, note: null }) };
      case "withdraw": return { id, run: (tx) => withdrawRecoveryCodeInTx(tx, { requestId: id, actorUserId: approverId, note: "Fixture withdrawal" }) };
      case "redemption": return { id, run: (tx) => redeem(tx) };
    }
  }

  it.each(transitions)("revalidates %s when password replacement holds the target lock first", async (operation) => {
    const { id, run } = await prepare(operation);
    const holding = Promise.withResolvers<number>();
    const waiting = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    observeActionTransaction(undefined, async (tx) => {
      holding.resolve(await backendPid(tx));
      await release.promise;
    });
    const replacement = changePasswordAction(passwordForm());
    let follow: ReturnType<typeof recovery<{ kind: string; requestId?: string }>> | undefined;
    try {
      const holder = await Promise.race([holding.promise, replacement.then(() => { throw new Error("Replacement did not acquire lock"); })]);
      follow = recovery(run, async (tx) => { waiting.resolve(await backendPid(tx)); });
      const waiter = await Promise.race([waiting.promise, follow.then(() => { throw new Error("Recovery did not reach transaction"); })]);
      await expectBlockedBy(waiter, holder);
    } finally {
      release.resolve();
      await replacement;
      await follow;
    }

    expect(await replacement).toEqual({ success: true });
    const result = await follow;
    expect(await passwordChangeAudits()).toBe(1);
    const winner = await credential();
    expect(winner.sessionVersion).toBe(1);
    expect(await bcrypt.compare(chosenPassword, winner.passwordHash)).toBe(true);
    if (operation === "filing") {
      expect(result?.kind).toBe("created");
      const freshId = result?.requestId;
      if (!freshId) throw new Error("Expected a fresh request");
      expect(await readRequest(freshId)).toMatchObject({ status: "PENDING" });
      expect(await recovery((tx) => issue(tx, freshId))).toMatchObject({ kind: "issued" });
      return;
    }

    if (!id) throw new Error("Expected a prior request");
    await expectRevoked(id);
    expect(result?.kind).toBe(operation === "redemption" ? "invalid" : "blocked");
    await expectNoCompletion(id);
    expect(await recovery((tx) => redeem(tx))).toEqual({ kind: "invalid" });
    expect(await credential()).toEqual(winner);
  });

  it.each(transitions)("orders %s before a waiting password replacement", async (operation) => {
    const { id, run } = await prepare(operation);
    const holding = Promise.withResolvers<number>();
    const waiting = Promise.withResolvers<number>();
    const release = Promise.withResolvers<void>();
    const first = recovery(run, undefined, async (tx) => {
      holding.resolve(await backendPid(tx));
      await release.promise;
    });
    let replacement: ReturnType<typeof changePasswordAction> | undefined;
    try {
      const holder = await Promise.race([holding.promise, first.then(() => { throw new Error("Recovery did not acquire lock"); })]);
      observeActionTransaction(async (tx) => { waiting.resolve(await backendPid(tx)); });
      replacement = changePasswordAction(passwordForm());
      const waiter = await Promise.race([waiting.promise, replacement.then(() => { throw new Error("Replacement did not reach transaction"); })]);
      await expectBlockedBy(waiter, holder);
    } finally {
      release.resolve();
      await first;
      await replacement;
    }

    const outcome = await first;
    const requestId = id ?? outcome.requestId;
    if (!requestId) throw new Error("Expected a recovery request");
    const result = await replacement;
    const winner = await credential();
    expect(winner.sessionVersion).toBe(1);
    if (operation === "redemption") {
      expect(outcome.kind).toBe("completed");
      expect(result).toMatchObject({ success: false });
      expect(winner.passwordHash).toBe(recoveryHash);
      expect(await passwordChangeAudits()).toBe(0);
      expect(auth.destroySession).not.toHaveBeenCalled();
      expect(await readRequest(requestId)).toMatchObject({ status: "COMPLETED", codeHash: null });
      expect(await db.prisma.notification.count({
        where: { recoveryRequestId: requestId, type: "RECOVERY_PASSWORD_CHANGED" },
      })).toBe(1);
      return;
    }

    expect(result).toEqual({ success: true });
    expect(await bcrypt.compare(chosenPassword, winner.passwordHash)).toBe(true);
    expect(await passwordChangeAudits()).toBe(1);
    if (operation === "reject" || operation === "withdraw") {
      expect(outcome.kind).toBe(operation === "reject" ? "rejected" : "withdrawn");
      expect(await readRequest(requestId)).toMatchObject(operation === "reject"
        ? { status: "REJECTED", revocationReason: null }
        : { status: "REVOKED", revocationReason: "WITHDRAWN" });
      return;
    }

    expect(outcome.kind).toBe(operation === "filing" ? "created" : "issued");
    await expectRevoked(requestId);
    if (operation !== "filing") {
      expect(await readRequest(requestId)).toMatchObject({
        codeIssuedByUserId: approverId, issueCount: operation === "issue" ? 1 : 2,
      });
      expect(await recovery((tx) => redeem(tx, operation === "reissue" ? replacementCode : originalCode)))
        .toEqual({ kind: "invalid" });
      await expectNoCompletion(requestId);
    }
  });
});
