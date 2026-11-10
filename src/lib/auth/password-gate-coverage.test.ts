import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Every protected page and server action must go through
 * requireAuthenticatedUser(), which enforces the forced password change.
 * Reading the session directly skips that gate, so only the files below may do
 * it. A new file that needs to must be reviewed and added here on purpose.
 */
const ALLOWED = new Set([
  "src/lib/auth/session.ts",
  "src/lib/auth/session-identity.ts",
  "src/lib/auth/guards.ts",
  // Rechecks the verified cookie against locked User rows, including the gate.
  "src/lib/authz/transaction-authority.ts",
  // Phase 3C rechecks signed claims against ordered, locked User rows.
  "src/features/household-management/lib/household-write.ts",
  // Phase 3D rechecks locked current lifecycle authority and the password gate.
  "src/features/village-management/lib/lifecycle-authority.ts",
  "src/app/change-password/page.tsx",
  "src/features/user-settings/actions/change-password.action.ts",
  "src/features/auth/actions/logout.action.ts",
  // Redirect-only pages: they send a signed-in user on to the dashboard,
  // which applies the gate itself.
  "src/app/page.tsx",
  "src/app/dashboard/page.tsx",
  "src/app/forbidden/page.tsx",
  "src/app/(auth)/login/page.tsx",
  "src/app/(auth)/signup/page.tsx",
  "src/app/(auth)/signup/register/page.tsx",
  // Mentions getCurrentUser in a comment only.
  "src/features/village-management/lib/village-lifecycle.ts",
  // Applies the gate explicitly (mustChangePassword check).
  "src/features/fund-management/actions/search-payment-status.action.ts",
]);

const DIRECT_READ = /\b(getCurrentUser|requireSessionUser|getSessionIdentity)\b/;
const ROOT = path.resolve(__dirname, "../../..");

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
      return [];
    }
    return [full];
  });
}

describe("forced password change gate", () => {
  it("is bypassed only by the reviewed files", () => {
    const offenders = listSourceFiles(path.join(ROOT, "src"))
      .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) =>
        DIRECT_READ.test(readFileSync(path.join(ROOT, file), "utf8")),
      );

    expect(offenders).toEqual([]);
  });
});
