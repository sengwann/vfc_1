import { AsyncLocalStorage } from "node:async_hooks";
import { MembershipStatus, UserRole, VillageStatus } from "@prisma/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth/auth.constants";
import { requireAuthenticatedUser } from "@/lib/auth/guards";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getCurrentUser, getSessionIdentity } from "@/lib/auth/session";
import { hashRecoveryCode } from "@/features/password-recovery/lib/recovery-code";
import { redeemRecoveryCodeInTx } from "@/features/password-recovery/lib/recovery-transitions";
import { changePasswordAction } from "@/features/user-settings/actions/change-password.action";
import { loginAction } from "./login.action";
import { logoutAction } from "./logout.action";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    user: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    passwordRecoveryRequest: { findFirst: vi.fn(), updateMany: vi.fn(), updateManyAndReturn: vi.fn() },
  };
  return {
    tx,
    prisma: {
      ...tx,
      $transaction: vi.fn((operation: (client: typeof tx) => Promise<unknown>) =>
        operation(tx),
      ),
    },
    cookies: vi.fn(),
    tryCreateAuditLog: vi.fn(),
    clearLoginThrottle: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`Redirect to ${path}`);
  },
}));
vi.mock("@/lib/auth/client-ip", () => ({ getClientIp: () => null }));
vi.mock("@/lib/auth/login-throttle", () => ({
  reserveLoginAttempt: async () => ({
    blocked: false,
    identifierKeyHash: "login-key",
    newLockouts: [],
  }),
  clearLoginThrottle: mocks.clearLoginThrottle,
  maybeCleanupLoginThrottle: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({
  AuditEntityType: {
    SESSION: "SESSION",
    USER: "USER",
    PASSWORD_RECOVERY_REQUEST: "PASSWORD_RECOVERY_REQUEST",
  },
  createAuditLog: vi.fn(),
  tryCreateAuditLog: mocks.tryCreateAuditLog,
}));
vi.mock("@/features/password-recovery/lib/recovery-notifications", () => ({
  syncRecoveryNotifications: vi.fn(),
}));

const initialVersion = 7;
const testSecret = "test-only-signing-key-for-session-regression";
const oldPassword = "test-current-password";
const newPassword = "test-replacement-password";
const email = "member@example.test";
const villageCode = "VFC1";
const accountDefaults = {
  id: "member-1",
  name: "Test Member",
  role: UserRole.VILLAGER,
  villageId: "village-1",
  houseId: "house-1",
  membershipStatus: MembershipStatus.ACTIVE,
  sessionVersion: initialVersion,
  email,
  phone: null,
  dateOfBirth: null,
  mustChangePassword: false,
  village: { status: VillageStatus.ACTIVE },
};

let oldHash: string;
let newHash: string;
let account: (typeof accountDefaults & { passwordHash: string }) | null;

function browser() {
  let token = "";
  return {
    get: (name: string) =>
      name === AUTH_COOKIE_NAME && token ? { name, value: token } : undefined,
    set: vi.fn((name: string, value: string) => {
      if (name === AUTH_COOKIE_NAME) token = value;
    }),
  };
}

const cookieContext = new AsyncLocalStorage<ReturnType<typeof browser>>();

function login(cookies: ReturnType<typeof browser>, password = oldPassword) {
  const form = new FormData();
  form.set("identifier", email);
  form.set("villageCode", villageCode);
  form.set("password", password);
  return cookieContext.run(cookies, () => loginAction(form));
}

function promiseBarrier() {
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  return {
    reached: reached.promise,
    release: release.resolve,
    pause() {
      reached.resolve();
      return release.promise;
    },
  };
}

const invalidCredentials = {
  success: false,
  code: "INVALID_CREDENTIALS",
  error: "Invalid credentials.",
};

// Return a copy so later writes cannot change an account snapshot already read by login.
function readAccount() {
  return account && { ...account };
}

async function changePassword(cookies: ReturnType<typeof browser>) {
  const form = new FormData();
  form.set("currentPassword", oldPassword);
  form.set("newPassword", newPassword);
  form.set("confirmPassword", newPassword);
  expect(await cookieContext.run(cookies, () => changePasswordAction(form)))
    .toEqual({ success: true });
  expect(cookies.get(AUTH_COOKIE_NAME)).toBeUndefined();
}

async function redeemRecovery() {
  const now = new Date("2026-01-01T00:00:00Z");
  const code = "ABCDEFGH";
  const id = "recovery-request-1";
  mocks.tx.passwordRecoveryRequest.findFirst.mockResolvedValueOnce({
    id,
    userId: accountDefaults.id,
    villageId: accountDefaults.villageId,
    status: "CODE_ISSUED",
    requestExpiresAt: new Date("2026-01-02T00:00:00Z"),
    codeExpiresAt: new Date("2026-01-01T01:00:00Z"),
    codeHash: hashRecoveryCode(testSecret, id, code),
    codeIssuedByUserId: "chief-1",
    issueCount: 1,
    failedRedeemAttempts: 0,
  });
  mocks.tx.passwordRecoveryRequest.updateMany.mockResolvedValueOnce({ count: 1 });
  expect(await redeemRecoveryCodeInTx(
    mocks.tx as unknown as Parameters<typeof redeemRecoveryCodeInTx>[0],
    {
      identifier: { type: "email", value: email },
      villageCode,
      now,
      code,
      secret: testSecret,
      newPasswordHash: newHash,
    },
  )).toMatchObject({ kind: "completed", userId: accountDefaults.id });
}

beforeAll(async () => {
  [oldHash, newHash] = await Promise.all([
    hashPassword(oldPassword),
    hashPassword(newPassword),
  ]);
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AUTH_SECRET", testSecret);
  account = { ...accountDefaults, passwordHash: oldHash };
  mocks.cookies.mockImplementation(async () => cookieContext.getStore());
  mocks.tx.user.findFirst.mockImplementation(async ({ select }) =>
    account && Object.fromEntries(
      Object.entries(account).filter(([key]) => select[key]),
    ),
  );
  mocks.tx.user.findUnique.mockImplementation(async () => readAccount());
  mocks.tx.$queryRaw.mockImplementation(async () => account ? [{ id: account.id }] : []);
  mocks.tx.passwordRecoveryRequest.updateManyAndReturn.mockResolvedValue([]);
  mocks.tx.user.updateMany.mockImplementation(async ({ where, data }) => {
    if (!account || account.id !== where.id || account.sessionVersion !== where.sessionVersion ||
      account.passwordHash !== where.passwordHash) return { count: 0 };
    await mocks.tx.user.update({ where, data });
    return { count: 1 };
  });
  mocks.tx.user.update.mockImplementation(async ({ where, data }) => {
    if (!account || account.id !== where.id) throw new Error("Account missing");
    account = {
      ...account,
      passwordHash: data.passwordHash ?? account.passwordHash,
      mustChangePassword: data.mustChangePassword ?? account.mustChangePassword,
      sessionVersion: account.sessionVersion + (data.sessionVersion?.increment ?? 0),
    };
    return readAccount();
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("login session revocation", () => {
  it("signs a session with the verified version and accepts it on a fresh request", async () => {
    const cookies = browser();
    expect(await login(cookies)).toEqual({ success: true, redirectTo: "/dashboard" });
    expect(cookies.set).toHaveBeenCalledWith(AUTH_COOKIE_NAME, expect.any(String), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    });
    await expect(cookieContext.run(cookies, getSessionIdentity)).resolves.toEqual({
      userId: accountDefaults.id,
      sessionVersion: initialVersion,
    });
    await expect(cookieContext.run(cookies, getCurrentUser)).resolves.toMatchObject({
      id: accountDefaults.id,
    });
  });

  it("routes an initial-password login to the forced-change page", async () => {
    account = { ...accountDefaults, passwordHash: oldHash, mustChangePassword: true };
    const cookies = browser();
    expect(await login(cookies)).toEqual({
      success: true,
      redirectTo: "/change-password",
    });
    await expect(cookieContext.run(cookies, getCurrentUser)).resolves.toMatchObject({
      mustChangePassword: true,
    });
    await expect(cookieContext.run(cookies, requireAuthenticatedUser))
      .rejects.toThrow("Redirect to /change-password");
  });

  it.each([
    { operation: "password change", revoke: changePassword },
    { operation: "recovery", revoke: redeemRecovery },
  ])(
    "rejects a pending login when $operation wins before the issuer comparison",
    async ({ revoke }) => {
      const existingCookies = browser();
      expect(await login(existingCookies)).toMatchObject({ success: true });
      const anotherBrowser = browser();
      anotherBrowser.set(AUTH_COOKIE_NAME, existingCookies.get(AUTH_COOKIE_NAME)!.value);
      vi.clearAllMocks();
      const pendingCookies = browser();
      const barrier = promiseBarrier();
      mocks.tx.user.findUnique.mockImplementationOnce(async () => {
        await barrier.pause();
        return readAccount();
      });
      const pendingLogin = login(pendingCookies);

      try {
        await Promise.race([barrier.reached, pendingLogin.then(() => {
          throw new Error("Login returned before the issuer comparison");
        })]);

        await revoke(existingCookies);
        expect(account?.sessionVersion).toBe(initialVersion + 1);
        expect(await verifyPassword(newPassword, account!.passwordHash)).toBe(true);
        await expect(cookieContext.run(anotherBrowser, getCurrentUser)).resolves.toBeNull();
      } finally {
        barrier.release();
        // Drain the pending request even if an assertion above fails.
        await pendingLogin.catch(() => undefined);
      }

      await expect(pendingLogin).resolves.toEqual(invalidCredentials);
      expect(pendingCookies.set).not.toHaveBeenCalled();
      expect(mocks.clearLoginThrottle).not.toHaveBeenCalled();
      expect(mocks.tryCreateAuditLog).not.toHaveBeenCalled();
      expect(await login(browser())).toEqual(invalidCredentials);
      expect(await login(browser(), newPassword)).toMatchObject({ success: true });
    },
  );

  it("returns the generic failure if the account is missing at issuance", async () => {
    const cookies = browser();
    mocks.tx.user.findUnique.mockResolvedValueOnce(null);

    await expect(login(cookies)).resolves.toEqual(invalidCredentials);
    expect(cookies.set).not.toHaveBeenCalled();
    expect(mocks.clearLoginThrottle).not.toHaveBeenCalled();
    expect(mocks.tryCreateAuditLog).not.toHaveBeenCalled();
  });

  it("rejects old sessions when logout wins after comparison but before cookie delivery", async () => {
    const existingCookies = browser();
    expect(await login(existingCookies)).toMatchObject({ success: true });
    const savedCookie = existingCookies.get(AUTH_COOKIE_NAME)!.value;
    const anotherBrowser = browser();
    anotherBrowser.set(AUTH_COOKIE_NAME, savedCookie);
    const pendingCookies = browser();
    const barrier = promiseBarrier();
    mocks.cookies.mockImplementationOnce(async () => {
      await barrier.pause();
      return pendingCookies;
    });
    const pendingLogin = login(pendingCookies);

    try {
      await Promise.race([barrier.reached, pendingLogin.then(() => {
        throw new Error("Login returned before cookie delivery");
      })]);
      await expect(cookieContext.run(existingCookies, logoutAction)).rejects.toThrow("Redirect to /login");
      expect(account?.sessionVersion).toBe(initialVersion + 1);
      expect(existingCookies.get(AUTH_COOKIE_NAME)).toBeUndefined();
      await expect(cookieContext.run(anotherBrowser, getCurrentUser)).resolves.toBeNull();
      expect(pendingCookies.set).not.toHaveBeenCalled();
    } finally {
      barrier.release();
      await pendingLogin.catch(() => undefined);
    }

    await expect(pendingLogin).resolves.toMatchObject({ success: true });
    await expect(cookieContext.run(pendingCookies, getSessionIdentity)).resolves.toEqual({
      userId: accountDefaults.id,
      sessionVersion: initialVersion,
    });
    await expect(cookieContext.run(pendingCookies, getCurrentUser)).resolves.toBeNull();
  });
});
