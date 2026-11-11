import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Village.status may change in exactly the places listed here. A System Admin
 * cannot deactivate a village directly: DEACTIVATED is reached only through the
 * deactivation workflow (approved request, 24h countdown, automatic
 * completion). Adding a new writer must be reviewed and added on purpose.
 *
 */
const STATUS_WRITERS = new Set([
  // Admin suspend / reactivate (deactivate is refused there).
  "src/features/village-management/lib/change-village-status.ts",
  // Automatic completion of an approved request, after its deadline.
  "src/features/village-deactivation/lib/deactivation-transitions.ts",
]);

const WRITE_PATTERNS = [
  /\bvillage\.(update|updateMany|upsert)\s*\(/,
  /UPDATE\s+"Village"/i,
];

const ROOT = path.resolve(__dirname, "../../../..");

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

// Test support code is not production code and never runs against real data.
const files = listFiles(path.join(ROOT, "src"))
  .filter((file) => !file.includes(`${path.sep}test-support${path.sep}`))
  .map((file) => ({
    path: path.relative(ROOT, file).split(path.sep).join("/"),
    text: readFileSync(file, "utf8"),
  }));

describe("direct village deactivation does not exist", () => {
  it("has no deactivate server action or confirmation dialog", () => {
    for (const removed of [
      "src/features/village-management/actions/deactivate-village.action.ts",
      "src/features/village-management/components/deactivate-village-dialog.tsx",
    ]) {
      expect(existsSync(path.join(ROOT, removed))).toBe(false);
    }
  });

  it("only the reviewed files write Village rows", () => {
    const writers = files
      .filter((file) => WRITE_PATTERNS.some((pattern) => pattern.test(file.text)))
      .map((file) => file.path)
      .filter((file) => !STATUS_WRITERS.has(file));

    expect(writers).toEqual([]);
  });

  it("no admin code path asks for the deactivate action", () => {
    const callers = files
      .filter((file) => file.path.startsWith("src/features/village-management/"))
      .filter((file) => /action:\s*"deactivate"/.test(file.text))
      .map((file) => file.path);

    expect(callers).toEqual([]);
  });
});
