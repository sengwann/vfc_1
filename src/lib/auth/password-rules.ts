/*
 * Pure password rules shared by registration and the change-password form.
 * No imports, so it can be unit tested directly.
 *
 * bcrypt only uses the first 72 BYTES of a password. Myanmar script takes
 * 3 bytes per character in UTF-8, so a character count alone is not enough:
 * a 30 character Burmese password would be silently cut short.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
export const PASSWORD_MAX_BYTES = 72;

export type PasswordRuleViolation = "LENGTH" | "TOO_MANY_BYTES";

/** Returns the first rule the password breaks, or null when it is acceptable. */
export function checkPasswordRules(
  password: string,
): PasswordRuleViolation | null {
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    return "LENGTH";
  }

  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) {
    return "TOO_MANY_BYTES";
  }

  return null;
}
