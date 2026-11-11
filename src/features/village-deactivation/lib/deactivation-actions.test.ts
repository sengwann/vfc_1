import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Static checks on the four workflow server actions: who may call them and
 * where their inputs come from. These are the "only the right role" rules from
 * the workflow document, pinned so a refactor cannot loosen them quietly.
 */
const ROOT = path.resolve(__dirname, "../../../..");
const read = (name: string) =>
  readFileSync(
    path.join(ROOT, "src/features/village-deactivation/actions", name),
    "utf8",
  );

const submit = read("submit-deactivation-request.action.ts");
const cancel = read("cancel-deactivation-request.action.ts");
const approve = read("approve-deactivation-request.action.ts");
const reject = read("reject-deactivation-request.action.ts");

describe("deactivation actions: who may call them", () => {
  it("submit and cancel are Chief only, and read the village from the session", () => {
    for (const text of [submit, cancel]) {
      expect(text).toMatch(/await requireChief\(\)/);
      expect(text).not.toMatch(/requireSystemAdmin/);
      expect(text).toMatch(/const \{ user, villageId \} = await requireChief\(\)/);
      expect(text).not.toMatch(/get\(["']villageId["']\)/);
    }
  });

  it("approve and reject are System Admin only", () => {
    for (const text of [approve, reject]) {
      expect(text).toMatch(/await requireSystemAdmin\(\)/);
      expect(text).not.toMatch(/requireChief/);
    }
  });

  it("every action authenticates before it touches the service", () => {
    for (const text of [submit, cancel, approve, reject]) {
      expect(text).toMatch(/^"use server";/);
      expect(text.indexOf("require")).toBeLessThan(text.indexOf("DeactivationRequest("));
    }
  });

  it("each action calls its own service function and nothing writes the database directly", () => {
    expect(submit).toMatch(/await submitDeactivationRequest\(/);
    expect(cancel).toMatch(/await cancelDeactivationRequest\(/);
    expect(approve).toMatch(/await approveDeactivationRequest\(/);
    expect(reject).toMatch(/await rejectDeactivationRequest\(/);

    for (const text of [submit, cancel, approve, reject]) {
      expect(text).not.toMatch(/prisma/);
    }
  });

  it("reject takes the cooldown from configuration, not from the form", () => {
    expect(reject).toMatch(/parseDeactivationConfig\(process\.env\)\.rejectionCooldownMs/);
    expect(reject).not.toMatch(/get\(["']cooldown/i);
  });

  it("cancel validates reason and confirmation through parseCancelInput", () => {
    expect(cancel).toMatch(/parseCancelInput\(formData\)/);
  });
});
