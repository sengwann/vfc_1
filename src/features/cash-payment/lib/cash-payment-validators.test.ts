import { describe, expect, it } from "vitest";
import { validateCashPaymentInput, validateVoidReason } from "./cash-payment-validators";

function form(amount: string): FormData {
  const data = new FormData();
  data.set("houseId", "house-1");
  data.set("payerUserId", "payer-1");
  data.set("amount", amount);
  return data;
}

describe("cash payment MMK validation", () => {
  it.each(["1000", "1500", "10000000"])("accepts payment %s", (amount) => {
    expect(validateCashPaymentInput(form(amount), 1_000)).toEqual({
      ok: true, data: { houseId: "house-1", payerUserId: "payer-1", amount: Number(amount) },
    });
  });

  it("rejects a partial payment using the actual assessment", () => {
    const result = validateCashPaymentInput(form("1000"), 1_001);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected partial payment rejection");
    expect(result.fieldErrors.amount).toContain("1,001");
  });

  it.each(["", "0", "-1", "0.5", "1000.5", "1e3", "10000001", "1000000000", "9007199254740992", "NaN", "Infinity"])(
    "rejects invalid payment %j", (amount) => {
      const result = validateCashPaymentInput(form(amount), 1);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected invalid payment rejection");
      expect(result.fieldErrors.amount).toBeDefined();
    },
  );

  it.each([0, -1, 0.5, NaN, Infinity, 10_000_001, Number.MAX_SAFE_INTEGER + 1])(
    "fails closed for invalid assessment %s", (assessment) => {
      expect(validateCashPaymentInput(form("10000000"), assessment).ok).toBe(false);
    },
  );

  it("accepts an assessment at the maximum", () => {
    expect(validateCashPaymentInput(form("10000000"), 10_000_000).ok).toBe(true);
  });

  it("preserves whitespace trimming for payment input", () => {
    expect(validateCashPaymentInput(form(" 1000 "), 1_000).ok).toBe(true);
  });

  it("still rejects missing house and payer", () => {
    const data = form("1000");
    data.delete("houseId");
    data.delete("payerUserId");
    expect(validateCashPaymentInput(data, 1_000)).toMatchObject({
      ok: false,
      fieldErrors: { houseId: "Select a house.", payerUserId: "Select a payer." },
    });
  });

  it("preserves void reason validation", () => {
    expect(validateVoidReason("short")).toEqual({ ok: true, data: "short" });
    expect(validateVoidReason("no").ok).toBe(false);
  });
});
