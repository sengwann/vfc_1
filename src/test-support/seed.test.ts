import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSeed } from "../../prisma/seed";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  hash: vi.fn(),
  openPool: vi.fn(),
  endPool: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("dotenv/config", () => ({}));
vi.mock("bcryptjs", () => ({ default: { hash: mocks.hash } }));
vi.mock("pg", () => ({
  Pool: class {
    constructor() {
      mocks.openPool();
    }
    end = mocks.endPool;
  },
}));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));
vi.mock("@prisma/client", () => ({
  UserRole: { SYSTEM_ADMIN: "SYSTEM_ADMIN" },
  PrismaClient: class {
    user = { findFirst: mocks.findFirst, create: mocks.create, update: mocks.update };
    $disconnect = mocks.disconnect;
  },
}));

const fixturePassword = "test-only-seed-password";
const fixtureHash = "test-only-password-hash";
const adminScope = {
  email: "seed-admin@example.test",
  role: "SYSTEM_ADMIN",
  villageId: null,
};

let previousExitCode: typeof process.exitCode;

beforeEach(() => {
  previousExitCode = process.exitCode;
  process.exitCode = undefined;
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("DATABASE_URL", "postgresql://127.0.0.1:1/seed-test");
  vi.stubEnv("SEED_ADMIN_EMAIL", " Seed-Admin@Example.Test ");
  vi.stubEnv("SEED_ADMIN_PASSWORD", undefined);
  vi.stubEnv("SEED_REPLACE_ADMIN_PASSWORD", undefined);
  vi.stubEnv("SEED_ALLOW_PRODUCTION", undefined);
  mocks.findFirst.mockResolvedValue({ id: "admin-1" });
  mocks.hash.mockResolvedValue(fixtureHash);
});

afterEach(() => {
  process.exitCode = previousExitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("SYSTEM_ADMIN seed credentials", () => {
  it("leaves the existing administrator untouched on repeated routine seeds", async () => {
    await runSeed();
    await runSeed();

    expect(process.exitCode).toBeUndefined();
    expect(mocks.findFirst).toHaveBeenCalledTimes(2);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: adminScope,
      select: { id: true },
    });
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([undefined, "true", "0"])(
    "ignores a supplied password when the replacement flag is %s",
    async (flag) => {
      vi.stubEnv("SEED_REPLACE_ADMIN_PASSWORD", flag);
      vi.stubEnv("SEED_ADMIN_PASSWORD", fixturePassword);

      await runSeed();

      expect(process.exitCode).toBeUndefined();
      expect(mocks.hash).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it.each(["SEED_ADMIN_EMAIL", "SEED_ADMIN_PASSWORD"])(
    "refuses to bootstrap an administrator when %s is missing",
    async (name) => {
      mocks.findFirst.mockResolvedValue(null);
      vi.stubEnv("SEED_ADMIN_PASSWORD", fixturePassword);
      vi.stubEnv(name, undefined);

      await runSeed();

      expect(process.exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledExactlyOnceWith(
        `Missing required seed environment variable: ${name}`,
      );
      expect(mocks.hash).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.update).not.toHaveBeenCalled();
      if (name === "SEED_ADMIN_EMAIL") {
        expect(mocks.openPool).not.toHaveBeenCalled();
      } else {
        expect(mocks.disconnect).toHaveBeenCalledOnce();
        expect(mocks.endPool).toHaveBeenCalledOnce();
      }
    },
  );

  it("bootstraps only with an explicitly supplied email and password", async () => {
    mocks.findFirst.mockResolvedValue(null);
    vi.stubEnv("SEED_ADMIN_PASSWORD", fixturePassword);

    await runSeed();

    expect(process.exitCode).toBeUndefined();
    expect(mocks.hash).toHaveBeenCalledExactlyOnceWith(fixturePassword, 10);
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      data: { ...adminScope, name: "System Admin", passwordHash: fixtureHash },
    });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledExactlyOnceWith("System administrator seed completed.");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("replaces the hash and increments the session version once in the same update", async () => {
    vi.stubEnv("SEED_REPLACE_ADMIN_PASSWORD", "1");
    vi.stubEnv("SEED_ADMIN_PASSWORD", fixturePassword);

    await runSeed();

    expect(process.exitCode).toBeUndefined();
    expect(mocks.hash).toHaveBeenCalledExactlyOnceWith(fixturePassword, 10);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: "admin-1", ...adminScope },
      data: { passwordHash: fixtureHash, sessionVersion: { increment: 1 } },
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledExactlyOnceWith("System administrator seed completed.");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("refuses explicit replacement without a password", async () => {
    vi.stubEnv("SEED_REPLACE_ADMIN_PASSWORD", "1");
    vi.stubEnv("SEED_ADMIN_PASSWORD", "   ");

    await runSeed();

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Missing required seed environment variable: SEED_ADMIN_PASSWORD",
    );
    expect(mocks.openPool).not.toHaveBeenCalled();
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refuses explicit replacement for an unknown administrator", async () => {
    mocks.findFirst.mockResolvedValue(null);
    vi.stubEnv("SEED_REPLACE_ADMIN_PASSWORD", "1");
    vi.stubEnv("SEED_ADMIN_PASSWORD", fixturePassword);

    await runSeed();

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Password replacement requires an existing system administrator.",
    );
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects a password that bcrypt would truncate", async () => {
    mocks.findFirst.mockResolvedValue(null);
    vi.stubEnv("SEED_ADMIN_PASSWORD", "é".repeat(37));

    await runSeed();

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "SEED_ADMIN_PASSWORD must be at least 8 characters and at most 72 UTF-8 bytes.",
    );
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("blocks production before opening a connection without the production opt-in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SEED_REPLACE_ADMIN_PASSWORD", "1");
    vi.stubEnv("SEED_ADMIN_PASSWORD", fixturePassword);

    await runSeed();

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Production seeding is disabled. Set SEED_ALLOW_PRODUCTION=1 and provide secure seed credentials.",
    );
    expect(mocks.openPool).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("redacts unexpected errors that contain password or hash data", async () => {
    vi.stubEnv("SEED_REPLACE_ADMIN_PASSWORD", "1");
    vi.stubEnv("SEED_ADMIN_PASSWORD", fixturePassword);
    mocks.update.mockRejectedValueOnce(new Error(`${fixturePassword} ${fixtureHash}`));

    await runSeed();

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith("System administrator seed failed.");
    expect(console.log).not.toHaveBeenCalled();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(mocks.endPool).toHaveBeenCalledOnce();
  });
});
