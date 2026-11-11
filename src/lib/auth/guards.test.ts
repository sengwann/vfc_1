import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./session", () => ({ getCurrentUser: mocks.getCurrentUser }));

import { requireAuthenticatedUser, requireSessionUser } from "./guards";

const baseUser = { id: "u1", role: "CHIEF", villageId: "v1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireSessionUser", () => {
  it("sends a signed-out visitor to /login", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(requireSessionUser()).rejects.toThrow("REDIRECT:/login");
  });

  it("returns a user who still has to change the password", async () => {
    const user = { ...baseUser, mustChangePassword: true };
    mocks.getCurrentUser.mockResolvedValue(user);
    await expect(requireSessionUser()).resolves.toBe(user);
  });
});

describe("requireAuthenticatedUser", () => {
  it("sends a signed-out visitor to /login", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(requireAuthenticatedUser()).rejects.toThrow("REDIRECT:/login");
  });

  it("sends a user with an initial password to /change-password", async () => {
    mocks.getCurrentUser.mockResolvedValue({
      ...baseUser,
      mustChangePassword: true,
    });
    await expect(requireAuthenticatedUser()).rejects.toThrow(
      "REDIRECT:/change-password",
    );
  });

  it("returns a normal user", async () => {
    const user = { ...baseUser, mustChangePassword: false };
    mocks.getCurrentUser.mockResolvedValue(user);
    await expect(requireAuthenticatedUser()).resolves.toBe(user);
  });
});
