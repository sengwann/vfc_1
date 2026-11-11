import { describe, expect, it } from "vitest";

import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_LENGTH,
  formatRecoveryCode,
  generateRecoveryCode,
  hashRecoveryCode,
  normalizeRecoveryCodeInput,
  verifyRecoveryCode,
} from "./recovery-code";

const SECRET = "s".repeat(32);
const OTHER_SECRET = "t".repeat(32);
const CODE = "ABCDEFGHJKMNPQRS";

/** A fixed byte source, so generation can be checked exactly. */
const fixedBytes = (values: number[]) => () => Uint8Array.from(values);

describe("alphabet", () => {
  it("is 32 distinct Crockford characters without I, L, O or U", () => {
    expect(RECOVERY_CODE_ALPHABET.length).toBe(32);
    expect(new Set(RECOVERY_CODE_ALPHABET).size).toBe(32);

    for (const banned of ["I", "L", "O", "U"]) {
      expect(RECOVERY_CODE_ALPHABET.includes(banned)).toBe(false);
    }
  });
});

describe("generateRecoveryCode", () => {
  it("makes 16 characters, all from the alphabet", () => {
    for (let run = 0; run < 200; run += 1) {
      const code = generateRecoveryCode();

      expect(code.length).toBe(RECOVERY_CODE_LENGTH);
      expect(
        [...code].every((c) => RECOVERY_CODE_ALPHABET.includes(c)),
      ).toBe(true);
    }
  });

  it("uses only the low 5 bits of each byte, so every character is equally likely", () => {
    const code = generateRecoveryCode(
      fixedBytes([
        0, 1, 31, 32, 33, 63, 64, 255, 128, 10, 20, 30, 40, 50, 60, 70,
      ]),
    );

    // byte & 31: 0,1,31,0,1,31,0,31,0,10,20,30,8,18,28,6
    const expected = [0, 1, 31, 0, 1, 31, 0, 31, 0, 10, 20, 30, 8, 18, 28, 6]
      .map((index) => RECOVERY_CODE_ALPHABET[index])
      .join("");

    expect(code).toBe(expected);
  });

  it("refuses a random source that returns too few bytes", () => {
    let message = "";
    try {
      generateRecoveryCode(fixedBytes([1, 2, 3]));
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBe("Not enough random bytes for a recovery code.");
  });

  it("does not repeat in a thousand codes", () => {
    const seen = new Set<string>();
    for (let run = 0; run < 1000; run += 1) {
      seen.add(generateRecoveryCode());
    }

    expect(seen.size).toBe(1000);
  });
});

describe("formatRecoveryCode", () => {
  it("shows four groups of four", () => {
    expect(formatRecoveryCode(CODE)).toBe("ABCD-EFGH-JKMN-PQRS");
  });
});

describe("normalizeRecoveryCodeInput", () => {
  it("accepts the displayed form and the bare form", () => {
    expect(normalizeRecoveryCodeInput("ABCD-EFGH-JKMN-PQRS")).toBe(CODE);
    expect(normalizeRecoveryCodeInput(CODE)).toBe(CODE);
  });

  it("ignores case, spaces and hyphens, as when dictated over the phone", () => {
    expect(normalizeRecoveryCodeInput("  abcd efgh-jkmn pqrs ")).toBe(CODE);
    expect(normalizeRecoveryCodeInput("abcd\tefgh\njkmn-pqrs")).toBe(CODE);
  });

  it("reads the Crockford look-alikes: O as 0, I and L as 1", () => {
    expect(normalizeRecoveryCodeInput("OOOO-IIII-LLLL-0011")).toBe(
      "0000111111110011",
    );
    expect(normalizeRecoveryCodeInput("oooo-iiii-llll-0011")).toBe(
      "0000111111110011",
    );
  });

  it("refuses the wrong length", () => {
    for (const bad of ["", "ABCD", `${CODE}A`, "ABCD-EFGH-JKMN-PQR"]) {
      expect(normalizeRecoveryCodeInput(bad)).toBe(null);
    }
  });

  it("refuses characters outside the alphabet, including U", () => {
    for (const bad of [
      "ABCD-EFGH-JKMN-PQRU",
      "ABCD-EFGH-JKMN-PQR!",
      "ABCD-EFGH-JKMN-PQR_",
      "ABCD-EFGH-JKMN-PQRé",
      "ABCD-EFGH-JKMN-PQR၁",
    ]) {
      expect(normalizeRecoveryCodeInput(bad)).toBe(null);
    }
  });

  it("refuses anything that is not text or is absurdly long", () => {
    for (const bad of [null, undefined, 1234567890123456, {}, ["A"], "A".repeat(65)]) {
      expect(normalizeRecoveryCodeInput(bad)).toBe(null);
    }
  });

  it("round-trips a generated code through display and typing", () => {
    for (let run = 0; run < 100; run += 1) {
      const code = generateRecoveryCode();
      expect(normalizeRecoveryCodeInput(formatRecoveryCode(code))).toBe(code);
      expect(
        normalizeRecoveryCodeInput(formatRecoveryCode(code).toLowerCase()),
      ).toBe(code);
    }
  });
});

describe("hashRecoveryCode", () => {
  it("is 64 lowercase hex characters, the shape the database accepts", () => {
    const hash = hashRecoveryCode(SECRET, "request-1", CODE);

    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it("is repeatable for the same inputs", () => {
    expect(hashRecoveryCode(SECRET, "request-1", CODE)).toBe(
      hashRecoveryCode(SECRET, "request-1", CODE),
    );
  });

  it("changes with the code, the request and the secret", () => {
    const base = hashRecoveryCode(SECRET, "request-1", CODE);

    expect(hashRecoveryCode(SECRET, "request-1", "ABCDEFGHJKMNPQRT")).toBe(
      hashRecoveryCode(SECRET, "request-1", "ABCDEFGHJKMNPQRT"),
    );
    expect(hashRecoveryCode(SECRET, "request-1", "ABCDEFGHJKMNPQRT") === base).toBe(false);
    expect(hashRecoveryCode(SECRET, "request-2", CODE) === base).toBe(false);
    expect(hashRecoveryCode(OTHER_SECRET, "request-1", CODE) === base).toBe(false);
  });

  it("never contains the code itself", () => {
    expect(hashRecoveryCode(SECRET, "request-1", CODE).toUpperCase().includes(CODE)).toBe(false);
  });

  it("refuses a secret shorter than 32 characters", () => {
    let message = "";
    try {
      hashRecoveryCode("short", "request-1", CODE);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBe("AUTH_SECRET must be at least 32 characters.");
  });
});

describe("verifyRecoveryCode", () => {
  const stored = hashRecoveryCode(SECRET, "request-1", CODE);

  it("accepts the right code for the right request", () => {
    expect(verifyRecoveryCode(SECRET, "request-1", CODE, stored)).toBe(true);
  });

  it("refuses a wrong code", () => {
    expect(verifyRecoveryCode(SECRET, "request-1", "ABCDEFGHJKMNPQRT", stored)).toBe(false);
  });

  it("refuses the right code on another request", () => {
    expect(verifyRecoveryCode(SECRET, "request-2", CODE, stored)).toBe(false);
  });

  it("refuses under a different secret", () => {
    expect(verifyRecoveryCode(OTHER_SECRET, "request-1", CODE, stored)).toBe(false);
  });

  it("answers false, not an error, when there is no usable stored hash", () => {
    for (const nothing of [null, "", "not-hex", "A".repeat(64), "a".repeat(63)]) {
      expect(verifyRecoveryCode(SECRET, "request-1", CODE, nothing)).toBe(false);
    }
  });

  it("never matches the all-zero dummy hash", () => {
    expect(verifyRecoveryCode(SECRET, "request-1", CODE, "0".repeat(64))).toBe(false);
  });
});
