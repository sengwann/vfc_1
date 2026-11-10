import { describe, expect, it } from "vitest";

import {
  RECOVERY_GENERIC_RESPONSE,
  RECOVERY_RESPONSE_FLOOR_MS,
} from "./recovery-config";
import {
  parseRecoveryRequestId,
  parseRecoveryRequestInput,
} from "./recovery-input";

describe("parseRecoveryRequestInput", () => {
  it("normalizes an email and a village code like sign-in does", () => {
    expect(
      parseRecoveryRequestInput({
        villageCode: "  ab 12 ",
        identifier: "  Aye@Example.COM ",
      }),
    ).toEqual({
      ok: true,
      data: {
        villageCode: "AB12",
        identifier: { type: "email", value: "aye@example.com" },
      },
    });
  });

  it("normalizes Myanmar phone numbers to the stored 09... form", () => {
    for (const phone of ["09 123 456 789", "+959123456789", "၀၉၁၂၃၄၅၆၇၈၉"]) {
      expect(
        parseRecoveryRequestInput({ villageCode: "VIL1", identifier: phone }),
      ).toEqual({
        ok: true,
        data: {
          villageCode: "VIL1",
          identifier: { type: "phone", value: "09123456789" },
        },
      });
    }
  });

  it("treats a blank village code as a System Admin account", () => {
    for (const blank of ["", "   ", undefined]) {
      const result = parseRecoveryRequestInput({
        villageCode: blank,
        identifier: "admin@example.com",
      });

      expect(result.ok && result.data.villageCode).toBe(null);
    }
  });

  it("fails without detail for a bad identifier or village code", () => {
    const bad = [
      { villageCode: "VIL1", identifier: "" },
      { villageCode: "VIL1", identifier: "not an identifier" },
      { villageCode: "VIL1", identifier: "a@b" },
      { villageCode: "VIL1", identifier: 12345 },
      { villageCode: "VIL1", identifier: undefined },
      { villageCode: "V", identifier: "a@b.co" },
      { villageCode: "VILLAGE-WITH-DASH", identifier: "a@b.co" },
      { villageCode: "A".repeat(21), identifier: "a@b.co" },
      { villageCode: 5, identifier: "a@b.co" },
    ];

    for (const input of bad) {
      expect(parseRecoveryRequestInput(input)).toEqual({ ok: false });
    }
  });
});

describe("parseRecoveryRequestId", () => {
  it("accepts ids made of letters, digits, dash and underscore", () => {
    for (const id of ["cm3abc123xyz", "itest-recovery-1b2c", "A_b-9"]) {
      expect(parseRecoveryRequestId(id)).toBe(id);
    }
  });

  it("refuses anything else", () => {
    for (const bad of [
      "",
      " ",
      "a b",
      "a'b",
      "a;drop",
      "../x",
      "x".repeat(65),
      null,
      undefined,
      7,
      {},
      ["a"],
    ]) {
      expect(parseRecoveryRequestId(bad)).toBe(null);
    }
  });
});

describe("recovery constants", () => {
  it("keeps the one generic sentence exactly as specified", () => {
    expect(RECOVERY_GENERIC_RESPONSE).toBe(
      "If this account exists, the appropriate administrator has been notified.",
    );
  });

  it("keeps a positive response-time floor", () => {
    expect(RECOVERY_RESPONSE_FLOOR_MS > 0).toBe(true);
  });
});
