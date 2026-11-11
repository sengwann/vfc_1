/*
 * Pure validation rules for creating a village. No imports, so it can be unit
 * tested directly with the Node test runner. Rules return error CODES, never
 * display text: the form maps codes to translation keys.
 *
 * Email and phone normalization is not here on purpose. It reuses
 * normalizeIdentifier() from src/lib/auth/validators.ts in village-validators.ts
 * so the stored identifier always matches what the login form looks up.
 */

const VILLAGE_CODE_REGEX = /^[A-Z0-9]{3,20}$/;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
/** bcrypt only uses the first 72 BYTES of a password. */
export const PASSWORD_MAX_BYTES = 72;

export type CreateVillageFieldErrorCode =
  | "CODE_INVALID"
  | "CODE_EXISTS"
  | "NAME_LENGTH"
  | "CHIEF_NAME_LENGTH"
  | "EMAIL_INVALID"
  | "EMAIL_EXISTS"
  | "PHONE_INVALID"
  | "PHONE_EXISTS"
  | "IDENTIFIER_REQUIRED"
  | "PASSWORD_LENGTH"
  | "PASSWORD_TOO_LONG";

export type CreateVillageFormErrorCode = "EXISTS" | "RETRY" | "GENERIC";

export function normalizeVillageCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

/** Expects an already normalized code. */
export function validateVillageCode(
  code: string,
): CreateVillageFieldErrorCode | null {
  return VILLAGE_CODE_REGEX.test(code) ? null : "CODE_INVALID";
}

/** Expects an already trimmed name. */
export function validateVillageName(
  name: string,
): CreateVillageFieldErrorCode | null {
  return name.length < 2 || name.length > 100 ? "NAME_LENGTH" : null;
}

/** Expects an already trimmed name. */
export function validateChiefName(
  name: string,
): CreateVillageFieldErrorCode | null {
  return name.length < 2 || name.length > 100 ? "CHIEF_NAME_LENGTH" : null;
}

export function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** The password is validated as typed (it is never trimmed). */
export function validatePassword(
  password: string,
): CreateVillageFieldErrorCode | null {
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    return "PASSWORD_LENGTH";
  }

  if (getUtf8ByteLength(password) > PASSWORD_MAX_BYTES) {
    return "PASSWORD_TOO_LONG";
  }

  return null;
}