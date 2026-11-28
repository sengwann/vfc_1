import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ProtectedLayout from "@/app/(protected)/layout";
import { updateSettingsAction } from "@/features/user-settings/actions/update-settings.action";
import { reactivateVillageAction } from "@/features/village-management/actions/reactivate-village.action";
import { suspendVillageAction } from "@/features/village-management/actions/suspend-village.action";
import { changeVillageStatusInTx } from "@/features/village-management/lib/change-village-status";
import { AUTH_COOKIE_NAME } from "@/lib/auth/auth.constants";
import { hashPassword } from "@/lib/auth/password";
import { getCurrentUser, getSessionIdentity } from "@/lib/auth/session";
import { openTestDatabase, type TestDatabase } from "@/test-support/test-database";
import { loginAction } from "./login.action";
import { logoutAction } from "./logout.action";

class Navigation extends Error {
  constructor(readonly path: string) {
    super(`Redirect to ${path}`);
  }
}

function browser(initialCookie?: string) {
  let value = initialCookie;
  return {
    get: (name: string) =>
      name === AUTH_COOKIE_NAME && value ? { name, value } : undefined,
    set: vi.fn((name: string, nextValue: string) => {
      if (name === AUTH_COOKIE_NAME) value = nextValue;
    }),
  };
}

type Browser = ReturnType<typeof browser>;
type RevocationObserver = {
  before: (tx: Prisma.TransactionClient, args: Prisma.UserUpdateManyAndReturnArgs) => Promise<void>;
  after?: (updatedCount: number) => void;
};

const browserContext = new AsyncLocalStorage<Browser>();
const revocationObserver = new AsyncLocalStorage<RevocationObserver>();
const database = vi.hoisted(() => ({ client: null as PrismaClient | null }));

vi.mock("next/headers", () => ({
  cookies: async () => {
    const client = browserContext.getStore();
    if (!client) throw new Error("Missing request cookie fixture");
    return client;
  },
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Navigation(path); },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get(_target, key) {
      const client = database.client!;
      const observer = revocationObserver.getStore();
      if (key === "user" && observer) {
        return new Proxy(client.user, {
          get(delegate, operation) {
            if (operation === "updateManyAndReturn") {
              return (args: Prisma.UserUpdateManyAndReturnArgs) =>
                client.$transaction(async (tx) => {
                  await observer.before(tx, args);
                  const updated = await tx.user.updateManyAndReturn(args);
                  observer.after?.(updated.length);
                  return updated;
                }, { isolationLevel: "ReadCommitted", timeout: 15_000 });
            }
            return Reflect.get(delegate, operation);
          },
        });
      }
      const value = Reflect.get(client, key);
      return typeof value === "function" ? value.bind(client) : value;
    },
  }),
}));

const initialVersion = 7;
const secret = "a04-integration-test-only-session-signing-key";
const password = "a04-fixture-login-password";

function cloneCookie(client: Browser): Browser {
  const value = client.get(AUTH_COOKIE_NAME)?.value;
  if (!value) throw new Error("Expected a signed session cookie");
  return browser(value);
}

function barrier<T>() {
  const arrived = Promise.withResolvers<T>();
  const resume = Promise.withResolvers<void>();
  return {
    reached: arrived.promise,
    release: resume.resolve,
    hold(value: T) {
      arrived.resolve(value);
      return resume.promise;
    },
  };
}

function reached<T>(gate: { reached: Promise<T> }, request: Promise<unknown>) {
  return Promise.race([
    gate.reached,
    request.then(() => { throw new Error("Request completed before reaching its barrier"); }),
  ]);
}

async function backendPid(tx: Prisma.TransactionClient) {
  const [row] = await tx.$queryRaw<[{ pid: number }]>`SELECT pg_backend_pid() AS pid`;
  return row.pid;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)("logout during village suspension (PostgreSQL)", () => {
  let db: TestDatabase;
  let villageId: string;
  let villageCode: string;
  let memberId: string;
  let adminId: string;
  let passwordHash: string;

  beforeAll(async () => {
    db = await openTestDatabase({ ...process.env, TEST_DATABASE_ALLOW_REMOTE: undefined }, { max: 4 });
    database.client = db.prisma;
    passwordHash = await hashPassword(password);
  });

  beforeEach(async () => {
    vi.stubEnv("AUTH_SECRET", secret);
    const fixtureId = randomUUID();
    villageId = `a04-village-${fixtureId}`;
    villageCode = `A04${fixtureId.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
    memberId = `a04-member-${fixtureId}`;
    adminId = `a04-admin-${fixtureId}`;
    await db.prisma.village.create({ data: { id: villageId, villageCode, name: "A04 fixture" } });
    await db.prisma.user.createMany({ data: [
      { id: memberId, villageId, email: email(memberId), name: "Chief", role: "CHIEF",
        membershipStatus: "ACTIVE", passwordHash, sessionVersion: initialVersion },
      { id: adminId, email: email(adminId), name: "Admin", role: "SYSTEM_ADMIN", passwordHash },
    ] });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (!db || !villageId) return;
    // Remove only records attributable to this disposable fixture.
    await db.pool.query('DELETE FROM "UserSettings" WHERE "userId" = $1', [memberId]);
    await db.pool.query('DELETE FROM "AuditLog" WHERE "actorUserId" = ANY($1)', [[memberId, adminId]]);
    await db.pool.query('DELETE FROM "User" WHERE id = ANY($1)', [[memberId, adminId]]);
    await db.pool.query('DELETE FROM "Village" WHERE id = $1', [villageId]);
  });

  afterAll(async () => {
    database.client = null;
    if (db) {
      await db.close();
      await db.pool.end();
    }
  });

  function email(id: string) {
    return `${id}@example.test`;
  }

  async function signIn(userId = memberId) {
    const form = new FormData();
    form.set("identifier", email(userId));
    form.set("password", password);
    if (userId === memberId) form.set("villageCode", villageCode);
    const client = browser();
    const result = await browserContext.run(client, () => loginAction(form));
    expect(result).toEqual({ success: true, redirectTo: "/dashboard" });
    return client;
  }

  async function signOut(client: Browser) {
    await expect(browserContext.run(client, logoutAction)).rejects.toMatchObject({ path: "/login" });
    expect(client.set).toHaveBeenLastCalledWith(AUTH_COOKIE_NAME, "", {
      httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 0,
    });
    expect(client.get(AUTH_COOKIE_NAME)).toBeUndefined();
  }

  async function changeVillage(client: Browser, action: typeof suspendVillageAction) {
    const form = new FormData();
    form.set("villageId", villageId);
    await expect(browserContext.run(client, () => action(form)))
      .rejects.toMatchObject({ path: `/admin/villages/${villageId}` });
  }

  async function persistedVersion(userId = memberId) {
    return (await db.prisma.user.findUniqueOrThrow({
      where: { id: userId }, select: { sessionVersion: true },
    })).sessionVersion;
  }

  async function status() {
    return (await db.prisma.village.findUniqueOrThrow({
      where: { id: villageId }, select: { status: true },
    })).status;
  }

  function logoutAudits() {
    return db.prisma.auditLog.findMany({
      where: { actionType: "LOGOUT", OR: [{ entityId: memberId }, { actorUserId: adminId }] },
      select: { entityType: true, entityId: true, actorUserId: true, villageId: true, metadata: true },
    });
  }

  async function expectOneLogoutAudit() {
    expect(await logoutAudits()).toEqual([{
      entityType: "SESSION", entityId: memberId, actorUserId: memberId, villageId,
      metadata: { userRole: "CHIEF", villageId },
    }]);
  }

  it("revokes both browser copies while suspended and leaves a new login valid after reactivation", async () => {
    const client1 = await signIn();
    const client2 = cloneCookie(client1);
    const admin = await signIn(adminId);
    expect(await browserContext.run(client2, getSessionIdentity))
      .toEqual({ userId: memberId, sessionVersion: initialVersion });
    expect(await browserContext.run(client2, getCurrentUser)).toMatchObject({ id: memberId });

    await changeVillage(admin, suspendVillageAction);
    expect(await status()).toBe("SUSPENDED");
    expect(await browserContext.run(client1, getCurrentUser)).toBeNull();
    expect(await persistedVersion()).toBe(initialVersion);
    await signOut(client1);
    expect(await persistedVersion()).toBe(initialVersion + 1);
    await expectOneLogoutAudit();

    await changeVillage(admin, reactivateVillageAction);
    expect(await status()).toBe("ACTIVE");
    expect(await browserContext.run(client2, getCurrentUser)).toBeNull();
    await expect(browserContext.run(client2, () => ProtectedLayout({ children: null })))
      .rejects.toMatchObject({ path: "/login" });
    const settings = new FormData();
    settings.set("language", "MY");
    await expect(browserContext.run(client2, () => updateSettingsAction(settings)))
      .rejects.toMatchObject({ path: "/login" });
    expect(await db.prisma.userSettings.count({ where: { userId: memberId } })).toBe(0);

    const freshClient = await signIn();
    expect(await browserContext.run(freshClient, getSessionIdentity))
      .toEqual({ userId: memberId, sessionVersion: initialVersion + 1 });
    expect(await browserContext.run(client2, getCurrentUser)).toBeNull();
    await signOut(client2);
    expect(await persistedVersion()).toBe(initialVersion + 1);
    expect(await browserContext.run(freshClient, getCurrentUser)).toMatchObject({ id: memberId });
    await expectOneLogoutAudit();
  });

  it("an active logout invalidates all copied tokens once", async () => {
    const client = await signIn();
    const copy = cloneCookie(client);
    expect(await status()).toBe("ACTIVE");
    expect(await persistedVersion()).toBe(initialVersion);
    await signOut(client);
    expect(await persistedVersion()).toBe(initialVersion + 1);
    expect(await browserContext.run(copy, getCurrentUser)).toBeNull();
    await signOut(copy);
    expect(await persistedVersion()).toBe(initialVersion + 1);
    await expectOneLogoutAudit();
  });

  it.each(["invalid signature", "expired", "missing"] as const)(
    "clears an %s cookie without a session update or success audit",
    async (kind) => {
      const token = kind === "missing" ? undefined : await new SignJWT({ sessionVersion: initialVersion })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(memberId)
        .setExpirationTime(kind === "expired" ? 1 : "5m")
        .sign(new TextEncoder().encode(kind === "invalid signature" ? `${secret}-wrong-key` : secret));
      const client = browser(token);
      expect(await browserContext.run(client, getSessionIdentity)).toBeNull();
      await signOut(client);
      expect(await persistedVersion()).toBe(initialVersion);
      expect(await persistedVersion(adminId)).toBe(0);
      expect(await logoutAudits()).toEqual([]);
    },
  );

  it("a paused logout cannot revoke the login issued after another client revokes its generation", async () => {
    const client = await signIn();
    const other = cloneCookie(client);
    const paused = barrier<number>();
    let otherPid: number | undefined;
    let staleUpdateCount: number | undefined;
    const pending = revocationObserver.run({
      before: async (tx, args) => {
        expect(args.where).toEqual({ id: memberId, sessionVersion: initialVersion });
        await paused.hold(await backendPid(tx));
      },
      after: (count) => { staleUpdateCount = count; },
    }, () => signOut(client));
    let oldPid: number;
    let freshClient: Browser;

    try {
      oldPid = await reached(paused, pending);
      await revocationObserver.run({
        before: async (tx) => { otherPid = await backendPid(tx); },
        after: (count) => expect(count).toBe(1),
      }, () => signOut(other));
      expect(otherPid).toEqual(expect.any(Number));
      expect(otherPid).not.toBe(oldPid);
      expect(await persistedVersion()).toBe(initialVersion + 1);
      freshClient = await signIn();
      expect(await browserContext.run(freshClient, getSessionIdentity))
        .toEqual({ userId: memberId, sessionVersion: initialVersion + 1 });
    } finally {
      paused.release();
      await pending;
    }
    expect(staleUpdateCount).toBe(0);
    expect(await persistedVersion()).toBe(initialVersion + 1);
    expect(await browserContext.run(freshClient, getCurrentUser)).toMatchObject({ id: memberId });
    await expectOneLogoutAudit();
    console.info("A04 stale logout: PostgreSQL backends and persisted session version", {
      oldPid, otherPid, staleUpdateCount, sessionVersion: await persistedVersion(),
    });
  });

  it.each(["suspension", "logout"] as const)(
    "revokes exactly once when %s commits first",
    async (first) => {
      const client = await signIn();
      const admin = await signIn(adminId);
      const suspension = barrier<number>();
      const revocation = barrier<number>();
      const pendingSuspension = browserContext.run(admin, () => db.prisma.$transaction(async (tx) => {
        const outcome = await changeVillageStatusInTx(tx, {
          villageId, actorUserId: adminId, action: "suspend", reason: null,
        });
        expect(outcome).toBe("ok");
        await suspension.hold(await backendPid(tx));
      }, { isolationLevel: "Serializable", timeout: 15_000 }));
      let pendingLogout: Promise<void> | undefined;
      try {
        const suspensionPid = await reached(suspension, pendingSuspension);
        pendingLogout = revocationObserver.run(
          { before: async (tx) => revocation.hold(await backendPid(tx)) },
          () => signOut(client),
        );
        const logoutPid = await reached(revocation, pendingLogout);
        expect(logoutPid).not.toBe(suspensionPid);
        expect(await persistedVersion()).toBe(initialVersion);
        if (first === "suspension") {
          suspension.release();
          await pendingSuspension;
          expect(await status()).toBe("SUSPENDED");
          expect(await persistedVersion()).toBe(initialVersion);
          revocation.release();
          await pendingLogout;
        } else {
          revocation.release();
          await pendingLogout;
          expect(await status()).toBe("ACTIVE");
          expect(await persistedVersion()).toBe(initialVersion + 1);
          suspension.release();
          await pendingSuspension;
        }
        expect(await status()).toBe("SUSPENDED");
        expect(await persistedVersion()).toBe(initialVersion + 1);
        await expectOneLogoutAudit();
        console.info("A04 suspension/logout order: PostgreSQL backends and persisted session version", {
          first, suspensionPid, logoutPid, sessionVersion: await persistedVersion(),
        });
      } finally {
        suspension.release();
        revocation.release();
        await Promise.allSettled([pendingSuspension, pendingLogout]);
      }
    },
  );
});
