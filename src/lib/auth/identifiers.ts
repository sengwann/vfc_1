/*
 * Pure email and phone normalization shared by sign-in, registration, profile
 * updates and Chief creation. It has no imports, so it can be unit tested
 * directly and used from any server module.
 *
 * The value that is STORED is the value that is LOOKED UP at sign-in, so every
 * place that accepts an identifier must go through these functions.
 */

export const IDENTIFIER_MAX_LENGTH = 191;
export const PHONE_RAW_MAX_LENGTH = 30;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_ALLOWED_CHARACTERS_REGEX = /^[0-9+\-\s()]+$/;
const PHONE_NORMALIZED_REGEX = /^\+?\d{5,15}$/;

// Myanmar mobile numbers written with the country code: +959..., 959...,
// 00959.... They are stored in the local form 09... so that the same number
// can never be registered twice just because it was typed differently.
const MYANMAR_INTERNATIONAL_REGEX = /^(?:\+|00)?959(\d{7,9})$/;

const BURMESE_DIGIT_REGEX = /[၀-၉]/g;

/** Converts Myanmar digits (U+1040 to U+1049) to ASCII digits. */
export function normalizeDigits(raw: string): string {
  return raw.replace(BURMESE_DIGIT_REGEX, (character) =>
    String(character.charCodeAt(0) - 0x1040),
  );
}

/** Returns the lower-cased email, or null when it is not a valid email. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();

  if (!email || email.length > IDENTIFIER_MAX_LENGTH) {
    return null;
  }

  return EMAIL_REGEX.test(email) ? email : null;
}

/**
 * Returns the single stored form of a phone number, or null when invalid.
 * Myanmar digits become ASCII, separators are removed, and +959... / 959... /
 * 00959... become 09.... Other numbers keep their leading "+" form.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = normalizeDigits(raw.trim());

  if (!trimmed || trimmed.length > PHONE_RAW_MAX_LENGTH) {
    return null;
  }

  if (!PHONE_ALLOWED_CHARACTERS_REGEX.test(trimmed)) {
    return null;
  }

  const compact = trimmed.replace(/[\s\-().]/g, "");
  const myanmar = MYANMAR_INTERNATIONAL_REGEX.exec(compact);
  const phone = myanmar ? `09${myanmar[1]}` : compact;

  return PHONE_NORMALIZED_REGEX.test(phone) ? phone : null;
}
