import { describe, expect, it } from "vitest";
import { validateCreateFundInput, validateFundInput } from "./fund-validators";

function form(amount: string): FormData {
  const data = new FormData();
  data.set("name", "Water Fund");
  data.set("totalAmount", amount);
  data.set("targetAmount", amount);
  data.set("startDate", "2026-11-07");
  data.set("endDate", "2026-12-31");
  return data;
}

describe("fund MMK form validation", () => {
  it.each(["1", "100001", "1000000000"])("preserves whole village target %s in create and edit contracts", (amount) => {
    const created = validateCreateFundInput(form(amount));
    const edited = validateFundInput(form(amount));
    expect(created.ok).toBe(true);
    expect(edited.ok).toBe(true);
    if (!created.ok || !edited.ok) throw new Error("Expected valid fund input");
    expect(created.data.totalAmount).toBe(Number(amount));
    expect(edited.data.targetAmount).toBe(Number(amount));
  });

  it.each(["", "0", "-1", "1.5", "1.0", "1e3", "1000000001", "9007199254740991", "9007199254740992", "NaN", "Infinity", "1\n"])(
    "rejects invalid amount %j for both form contracts", (amount) => {
      const created = validateCreateFundInput(form(amount));
      const edited = validateFundInput(form(amount));
      expect(created.ok).toBe(false);
      expect(edited.ok).toBe(false);
      if (created.ok || edited.ok) throw new Error("Expected invalid fund input");
      expect(created.fieldErrors.totalAmount).toBeDefined();
      expect(edited.fieldErrors.targetAmount).toBeDefined();
    },
  );

  it("does not enforce an activation assessment limit while validating a draft target", () => {
    expect(validateCreateFundInput(form("20000000")).ok).toBe(true);
  });

  it("still validates nonfinancial fields", () => {
    const data = form("100001");
    data.set("name", "x");
    data.set("endDate", "2026-11-06");
    expect(validateCreateFundInput(data)).toMatchObject({
      ok: false,
      fieldErrors: { name: expect.any(String), endDate: expect.any(String) },
    });
  });
});
