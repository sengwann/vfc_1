import { afterEach, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ initialized: vi.fn() }));
vi.mock("../prisma", () => {
  boundary.initialized();
  throw new Error("GLOBAL_PRISMA_IMPORT_FORBIDDEN");
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it("imports real transactional authority without DATABASE_URL or global Prisma initialization", async () => {
  vi.resetModules();
  vi.stubEnv("DATABASE_URL", "");
  const module = await import("./transaction-authority");
  expect(module.authorizeFinancialTransaction).toBeTypeOf("function");
  expect(boundary.initialized).not.toHaveBeenCalled();
});
