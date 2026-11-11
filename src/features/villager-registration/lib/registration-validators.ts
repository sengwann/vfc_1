import "server-only";

import { normalizeEmail, normalizePhone } from "@/lib/auth/identifiers";
import { checkPasswordRules } from "@/lib/auth/password-rules";

const VILLAGE_CODE_REGEX = /^[A-Z0-9]{3,20}$/;
const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

export const PASSWORD_BYTES_MESSAGE =
  "Password is too long. Myanmar characters count as 3 each; use at most 72 bytes (about 24 Myanmar characters).";

export type VillageCodeField = "villageCode";
export type RegisterField =
  | "villageCode"
  | "name"
  | "email"
  | "phone"
  | "identifier"
  | "password"
  | "houseNumber"
  | "dateOfBirth";

export interface NormalizedVillageCodeInput {
  villageCode: string;
}

export type VillageCodeValidationResult =
  | { ok: true; data: NormalizedVillageCodeInput }
  | {
      ok: false;
      fieldErrors: Partial<Record<VillageCodeField, string>>;
      formError?: string;
    };

export interface NormalizedRegisterInput {
  villageCode: string;
  name: string;
  email: string | null;
  phone: string | null;
  password: string;
  houseNumber: string;
  dateOfBirth: Date | null;
}

export type RegisterValidationResult =
  | { ok: true; data: NormalizedRegisterInput }
  | {
      ok: false;
      fieldErrors: Partial<Record<RegisterField, string>>;
      formError?: string;
    };

function getFormDataString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value === "string") return value;
  return "";
}

export function normalizeVillageCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function normalizeHouseNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

export function validateVillageCodeInput(
  formData: FormData,
): VillageCodeValidationResult {
  const rawVillageCode = getFormDataString(formData, "villageCode");
  const villageCode = normalizeVillageCode(rawVillageCode);
  if (!VILLAGE_CODE_REGEX.test(villageCode)) {
    return { ok: false, fieldErrors: { villageCode: "Invalid village code." } };
  }
  return { ok: true, data: { villageCode } };
}

/**
 * Parses a date string (YYYY-MM-DD) into a Date object.
 * Returns null if empty, malformed, not a real calendar date, in the future,
 * or unreasonably old.
 */
function parseOptionalDate(raw: string): Date | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (!DATE_REGEX.test(trimmed)) return null;

  const date = new Date(trimmed + "T00:00:00Z");
  if (isNaN(date.getTime())) return null;

  // Reject dates that JavaScript would roll over (e.g. 2023-02-31).
  if (date.toISOString().slice(0, 10) !== trimmed) return null;

  // Must not be in the future
  if (date > new Date()) return null;

  // Must not be unreasonably old
  if (date < new Date("1900-01-01")) return null;

  return date;
}

export function validateRegisterInput(
  formData: FormData,
): RegisterValidationResult {
  // The village code is a hidden field, so a bad value is not something the
  // visitor can fix in the form. Report it as a form-level error and stop.
  const rawVillageCode = getFormDataString(formData, "villageCode");
  const villageCode = normalizeVillageCode(rawVillageCode);
  if (!VILLAGE_CODE_REGEX.test(villageCode)) {
    return {
      ok: false,
      fieldErrors: {},
      formError: "Invalid village code.",
    };
  }

  const fieldErrors: Partial<Record<RegisterField, string>> = {};

  const rawName = getFormDataString(formData, "name");
  const name = rawName.trim();
  const rawEmail = getFormDataString(formData, "email").trim();
  const rawPhone = getFormDataString(formData, "phone").trim();
  const rawPassword = getFormDataString(formData, "password");
  const rawHouseNumber = getFormDataString(formData, "houseNumber");
  const houseNumber = normalizeHouseNumber(rawHouseNumber);
  const rawDateOfBirth = getFormDataString(formData, "dateOfBirth");

  if (name.length < 2 || name.length > 100) {
    fieldErrors.name = "Name must be between 2 and 100 characters.";
  }

  let email: string | null = null;
  let phone: string | null = null;
  if (rawEmail) {
    email = normalizeEmail(rawEmail);
    if (!email) {
      fieldErrors.email = "Email is invalid.";
    }
  }
  if (rawPhone) {
    phone = normalizePhone(rawPhone);
    if (!phone) {
      fieldErrors.phone = "Phone number is invalid.";
    }
  }
  if (!rawEmail && !rawPhone) {
    fieldErrors.identifier =
      "Provide at least one login identifier: email or phone.";
  }
  const passwordViolation = checkPasswordRules(rawPassword);
  if (passwordViolation === "LENGTH") {
    fieldErrors.password = "Password must be between 8 and 72 characters.";
  } else if (passwordViolation === "TOO_MANY_BYTES") {
    fieldErrors.password = PASSWORD_BYTES_MESSAGE;
  }
  if (houseNumber.length < 2 || houseNumber.length > 30) {
    fieldErrors.houseNumber = "Select a valid house number.";
  }

  // DOB is optional. Only validate if provided.
  let dateOfBirth: Date | null = null;
  if (rawDateOfBirth.trim()) {
    dateOfBirth = parseOptionalDate(rawDateOfBirth);
    if (!dateOfBirth) {
      fieldErrors.dateOfBirth =
        "Date of birth is invalid. It cannot be in the future.";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    data: {
      villageCode,
      name,
      email,
      phone,
      password: rawPassword,
      houseNumber,
      dateOfBirth,
    },
  };
}
