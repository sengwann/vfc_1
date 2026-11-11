import type { TranslationKey } from "../../../lib/i18n/en";

/*
 * The server actions answer in English. These are their exact messages, mapped
 * to translation keys so the screens can show them in the visitor's language.
 * Presentation only: the validators and actions are untouched, and any message
 * that is not listed here is shown exactly as the server sent it.
 */
const SERVER_MESSAGES: Record<string, TranslationKey> = {
  "Invalid village code.": "signup.invalidCode",
  "Name must be between 2 and 100 characters.": "signup.err.name",
  "Email is invalid.": "signup.err.email",
  "Phone number is invalid.": "signup.err.phone",
  "Provide at least one login identifier: email or phone.":
    "signup.err.identifier",
  "Password must be between 8 and 72 characters.": "signup.err.password",
  "Password is too long. Myanmar characters count as 3 each; use at most 72 bytes (about 24 Myanmar characters).":
    "signup.err.passwordBytes",
  "Too many attempts. Please try again later.": "signup.err.throttled",
  "Select a valid house number.": "signup.err.houseNumber",
  "Date of birth is invalid. It cannot be in the future.": "signup.err.dob",
  "Selected house is not available.": "signup.err.houseUnavailable",
  "An account with this email already exists.": "signup.err.emailExists",
  "An account with this phone already exists.": "signup.err.phoneExists",
  "An account with those details already exists.": "signup.err.accountExists",
  "Unable to register. Please try again.": "signup.err.generic",
  "Unable to register.": "signup.err.generic",
};

export function translateServerMessage(
  t: (key: TranslationKey) => string,
  message: string | undefined,
): string | undefined {
  if (!message) {
    return undefined;
  }
  const key = SERVER_MESSAGES[message];
  return key ? t(key) : message;
}
