import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/*
 * The one-time reset code the Chief hands to a member (in person or by phone).
 *
 * Alphabet: Crockford base32, "0123456789ABCDEFGHJKMNPQRSTVWXYZ". It has no I,
 * L, O or U, so a code read aloud or written down is hard to mistake.
 * Length: 16 characters, 5 bits each = 80 bits of entropy. Shown to people as
 * four groups, XXXX-XXXX-XXXX-XXXX. Guessing is not feasible online (a handful
 * of tries per request, then the code is revoked) and offline guessing needs
 * both the database and AUTH_SECRET.
 *
 * Generation is unbiased: 32 divides 256, so taking the low 5 bits of a random
 * byte gives every character exactly the same chance.
 *
 * Storage: only an HMAC-SHA-256 of the code is stored, never the code. The key
 * is derived from AUTH_SECRET with a label of its own, and the request id is
 * part of the input, so the same code on two requests hashes differently and a
 * hash cannot be copied from one request to another. The output is 64 lowercase
 * hex characters, which is exactly what the database CHECK accepts. HMAC is
 * used instead of bcrypt because the code is random and long: there is nothing
 * to slow down, and a fast hash keeps the redeem endpoint cheap to protect.
 *
 * The secret is always passed in (like hashThrottleKey), so this file reads no
 * environment and can be unit tested directly.
 */

export const RECOVERY_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const RECOVERY_CODE_LENGTH = 16;
export const RECOVERY_CODE_GROUP_SIZE = 4;

const KEY_LABEL = "recovery-code:v1";
const MIN_SECRET_LENGTH = 32;
const HASH_HEX = /^[0-9a-f]{64}$/;

/** A fresh random code, 16 characters, no separators. */
export function generateRecoveryCode(
  random: (size: number) => Uint8Array = randomBytes,
): string {
  const bytes = random(RECOVERY_CODE_LENGTH);

  if (bytes.length < RECOVERY_CODE_LENGTH) {
    throw new Error("Not enough random bytes for a recovery code.");
  }

  let code = "";
  for (let index = 0; index < RECOVERY_CODE_LENGTH; index += 1) {
    code += RECOVERY_CODE_ALPHABET[bytes[index] & 31];
  }

  return code;
}

/** "ABCDEFGHJKMNPQRS" -> "ABCD-EFGH-JKMN-PQRS". Display only. */
export function formatRecoveryCode(code: string): string {
  const groups: string[] = [];

  for (let start = 0; start < code.length; start += RECOVERY_CODE_GROUP_SIZE) {
    groups.push(code.slice(start, start + RECOVERY_CODE_GROUP_SIZE));
  }

  return groups.join("-");
}

/**
 * Turns whatever a person typed into the canonical 16 characters, or null.
 * Forgiving where it is safe: case, spaces, hyphens and the Crockford
 * look-alikes (O is read as 0, I and L as 1). Strict everywhere else: wrong
 * length or any other character gives null.
 */
export function normalizeRecoveryCodeInput(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 64) {
    return null;
  }

  const cleaned = raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");

  if (cleaned.length !== RECOVERY_CODE_LENGTH) {
    return null;
  }

  for (const character of cleaned) {
    if (!RECOVERY_CODE_ALPHABET.includes(character)) {
      return null;
    }
  }

  return cleaned;
}

function derivedKey(secret: string): Buffer {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error("AUTH_SECRET must be at least 32 characters.");
  }

  return createHmac("sha256", secret).update(KEY_LABEL).digest();
}

/** HMAC-SHA-256 of the canonical code, bound to the request. 64 hex chars. */
export function hashRecoveryCode(
  secret: string,
  requestId: string,
  code: string,
): string {
  return createHmac("sha256", derivedKey(secret))
    .update(`${requestId}\u0000${code}`)
    .digest("hex");
}

/**
 * Constant-time check of a submitted (already normalized) code against the
 * stored hash. When there is nothing valid to compare with (no request, a
 * request without a code), it still does the same work against a dummy hash
 * and answers false, so the time taken does not say which case it was.
 */
export function verifyRecoveryCode(
  secret: string,
  requestId: string,
  code: string,
  storedHash: string | null,
): boolean {
  const submitted = Buffer.from(hashRecoveryCode(secret, requestId, code), "hex");
  const usable = typeof storedHash === "string" && HASH_HEX.test(storedHash);
  const expected = Buffer.from(usable ? storedHash : "0".repeat(64), "hex");

  const equal = timingSafeEqual(submitted, expected);

  return usable && equal;
}
