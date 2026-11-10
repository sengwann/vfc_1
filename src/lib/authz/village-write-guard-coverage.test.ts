import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Mutation inventory for the Village Deactivation Workflow read-only rule.
 *
 * Every server action is either a village-scoped mutation that MUST call
 * guardVillageWrite inside its transaction (INVENTORY), or is deliberately
 * exempt with a reason (EXEMPT). A new server action fails this test until it
 * is classified on purpose, so a new write path cannot silently skip the
 * guard. This is a static scan: the behavior of the guard itself is covered by
 * village-deactivation-rules.test.ts, the action tests and the integration
 * tests.
 */
const INVENTORY = [
  // Payments
  "src/features/cash-payment/actions/record-cash-payment.action.ts",
  "src/features/cash-payment/actions/void-payment.action.ts",
  // Collectors
  "src/features/collector-assignment/actions/assign-collector.action.ts",
  "src/features/collector-assignment/actions/deactivate-collector-assignment.action.ts",
  // Funds
  "src/features/fund-management/actions/activate-fund.action.ts",
  "src/features/fund-management/actions/close-fund.action.ts",
  "src/features/fund-management/actions/create-fund.action.ts",
  "src/features/fund-management/actions/update-fund.action.ts",
  // Houses
  "src/features/house-management/actions/create-house.action.ts",
  "src/features/house-management/actions/deactivate-house.action.ts",
  "src/features/house-management/actions/reactivate-house.action.ts",
  "src/features/house-management/actions/update-house-number.action.ts",
  // Households and members
  "src/features/household-management/actions/approve-member.action.ts",
  "src/features/household-management/actions/change-head.action.ts",
  "src/features/household-management/actions/chief-approve-first-member.action.ts",
  "src/features/household-management/actions/chief-reject-pending-member.action.ts",
  "src/features/household-management/actions/reject-member.action.ts",
  "src/features/household-management/actions/remove-member.action.ts",
  // Joining a village
  "src/features/membership-rejoin/actions/submit-rejoin-request.action.ts",
  "src/features/villager-registration/actions/register-villager.action.ts",
  // Village-scoped profile edits (blocked while read-only)
  "src/features/user-settings/actions/update-profile.action.ts",
] as const;

const EXEMPT: Record<string, string> = {
  "src/features/auth/actions/login.action.ts":
    "Authentication must keep working; it writes no village records.",
  "src/features/auth/actions/logout.action.ts":
    "Sign-out must keep working.",
  "src/features/user-settings/actions/change-password.action.ts":
    "Password changes are a security operation the rules preserve.",
  "src/features/user-settings/actions/update-settings.action.ts":
    "Language preference only; preserved during read-only.",
  "src/features/villager-registration/actions/validate-village-code.action.ts":
    "Read-only lookup.",
  "src/features/fund-management/actions/search-payment-status.action.ts":
    "Read-only search.",
  "src/features/village-deactivation/actions/submit-deactivation-request.action.ts":
    "Workflow transition: a pending request restricts nothing, and the service takes the village lock itself.",
  "src/features/village-deactivation/actions/cancel-deactivation-request.action.ts":
    "Must work while the village is read-only (it is how read-only ends); the service takes the village lock and enforces the deadline.",
  "src/features/village-deactivation/actions/approve-deactivation-request.action.ts":
    "System Admin workflow transition; it is what starts read-only, and it takes the village lock itself.",
  "src/features/village-deactivation/actions/reject-deactivation-request.action.ts":
    "System Admin workflow transition; the village stays fully operational.",
  "src/features/notifications/actions/mark-notifications-read.action.ts":
    "Changes only the signed-in user's own read marks, never village records; it must work during read-only.",
  "src/features/village-management/actions/create-village.action.ts":
    "Platform action that creates a new village; there is no village to guard yet.",
  "src/features/village-management/actions/suspend-village.action.ts":
    "System Admin lifecycle action; blocked during the countdown (Phase 4).",
  "src/features/village-management/actions/reactivate-village.action.ts":
    "System Admin lifecycle action.",
  "src/features/password-recovery/actions/request-password-recovery.action.ts":
    "Public form with no signed-in user; writes only a recovery request, never village financial records, and recovery must keep working while a village is read-only.",
  "src/features/password-recovery/actions/redeem-recovery-code.action.ts":
    "Public form with no signed-in user; it changes the member's own password, a security operation the rules preserve during read-only.",
  "src/features/password-recovery/actions/issue-recovery-code.action.ts":
    "Security operation: a Chief must be able to help a member regain access even while the village is read-only; it writes no village financial records.",
  "src/features/password-recovery/actions/decide-recovery-request.action.ts":
    "Security operation (reject or withdraw a recovery request); it writes no village financial records and must work during read-only.",
  "src/features/password-recovery/actions/mark-recovery-notifications-read.action.ts":
    "Changes only the signed-in user's own read marks, never village records; it must work during read-only.",
};

const ROOT = path.resolve(__dirname, "../../..");

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
      return [];
    }
    return [full];
  });
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

const files = listFiles(path.join(ROOT, "src")).map((file) => ({
  path: relative(file),
  text: readFileSync(file, "utf8"),
}));

const serverActions = files.filter((file) =>
  /^\s*["']use server["']/m.test(file.text),
);

describe("village mutation guard coverage", () => {
  it("has exactly 21 inventoried mutation entry points", () => {
    expect(new Set(INVENTORY).size).toBe(21);
  });

  it("classifies every server action as guarded or deliberately exempt", () => {
    const unclassified = serverActions
      .map((file) => file.path)
      .filter(
        (file) =>
          !(INVENTORY as readonly string[]).includes(file) && !(file in EXEMPT),
      );

    expect(unclassified).toEqual([]);
  });

  it("has no stale inventory or exemption entries", () => {
    const actionPaths = new Set(serverActions.map((file) => file.path));
    const stale = [...INVENTORY, ...Object.keys(EXEMPT)].filter(
      (file) => !actionPaths.has(file),
    );

    expect(stale).toEqual([]);
  });

  for (const file of INVENTORY) {
    it(`${file} calls guardVillageWrite inside a transaction`, () => {
      const text = files.find((candidate) => candidate.path === file)?.text;

      expect(text).toBeDefined();
      expect(text).toMatch(/import \{[^}]*\b(?:guardVillageWrite|beginHouseholdWrite|authorizeFinancialTransaction)\b[^}]*\} from/);

      const call = Math.max(text!.indexOf("guardVillageWrite(tx,"), text!.indexOf("beginHouseholdWrite(tx,"), text!.indexOf("authorizeFinancialTransaction(tx,"));
      const transaction = text!.indexOf("$transaction(");

      expect(call).toBeGreaterThan(-1);
      expect(transaction).toBeGreaterThan(-1);
      expect(call).toBeGreaterThan(transaction);
    });
  }

  it("keeps exactly one village guard: lockActiveVillage is gone", () => {
    const users = files
      .filter((file) => /\blockActiveVillage\b/.test(file.text))
      .map((file) => file.path);

    expect(users).toEqual([]);
  });

  it("never gates routes, layouts or pages (mutation-level enforcement only)", () => {
    const routeLevel = files
      .filter((file) => file.path.startsWith("src/app/"))
      .filter((file) => /\b(guardVillageWrite|beginHouseholdWrite)\b/.test(file.text))
      .map((file) => file.path);

    expect(routeLevel).toEqual([]);
  });

  it("only the guard and the submit check lock the village row FOR SHARE", () => {
    const lockers = files
      .filter((file) => /FROM "Village"[\s\S]{0,120}FOR SHARE/.test(file.text))
      .map((file) => file.path);

    // The submit transition takes the same shared lock to read the village
    // status; it writes no village data, so it is not a mutation guard.
    expect(lockers).toEqual([
      "src/features/village-deactivation/lib/deactivation-transitions.ts",
      "src/lib/authz/village-write-guard.ts",
    ]);
  });
});
