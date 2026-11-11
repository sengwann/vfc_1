import "server-only";
import { LanguagePreference } from "@prisma/client";
import { normalizeEmail, normalizePhone } from "@/lib/auth/identifiers";
import { checkPasswordRules } from "@/lib/auth/password-rules";

const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

// ── Profile ─────────────────────────────────────────────────────

export type ProfileField =
  | "name"
  | "email"
  | "phone"
  | "identifier"
  | "dateOfBirth";

export interface NormalizedProfileInput {
  name: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
}

export type ProfileValidationResult =
  | { ok: true; data: NormalizedProfileInput }
  | {
      ok: false;
      fieldErrors: Partial<Record<ProfileField, string>>;
      formError?: string;
    };

function getFormDataString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value === "string") {
    return value;
  }
  return "";
}

function parseOptionalDate(raw: string): Date | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (!DATE_REGEX.test(trimmed)) return null;
  const date = new Date(trimmed + "T00:00:00Z");
  if (isNaN(date.getTime())) return null;
  if (date > new Date()) return null;
  if (date < new Date("1900-01-01")) return null;
  return date;
}

export function validateProfileInput(
  formData: FormData,
): ProfileValidationResult {
  const fieldErrors: Partial<Record<ProfileField, string>> = {};

  const rawName = getFormDataString(formData, "name");
  const rawEmail = getFormDataString(formData, "email").trim();
  const rawPhone = getFormDataString(formData, "phone").trim();
  const rawDateOfBirth = getFormDataString(formData, "dateOfBirth");

  const name = rawName.trim();
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

  return { ok: true, data: { name, email, phone, dateOfBirth } };
}

// ── Password ────────────────────────────────────────────────────

export type PasswordField =
  | "currentPassword"
  | "newPassword"
  | "confirmPassword";

export interface NormalizedPasswordInput {
  currentPassword: string;
  newPassword: string;
}

export type PasswordValidationResult =
  | { ok: true; data: NormalizedPasswordInput }
  | {
      ok: false;
      fieldErrors: Partial<Record<PasswordField, string>>;
      formError?: string;
    };

export function validatePasswordInput(
  formData: FormData,
): PasswordValidationResult {
  const fieldErrors: Partial<Record<PasswordField, string>> = {};

  const currentPassword = getFormDataString(formData, "currentPassword");
  const newPassword = getFormDataString(formData, "newPassword");
  const confirmPassword = getFormDataString(formData, "confirmPassword");

  if (!currentPassword) {
    fieldErrors.currentPassword = "Current password is required.";
  }

  const passwordViolation = checkPasswordRules(newPassword);
  if (passwordViolation === "LENGTH") {
    fieldErrors.newPassword =
      "New password must be between 8 and 72 characters.";
  } else if (passwordViolation === "TOO_MANY_BYTES") {
    fieldErrors.newPassword =
      "New password is too long. Myanmar characters count as 3 each; use at most 72 bytes (about 24 Myanmar characters).";
  }

  if (newPassword !== confirmPassword) {
    fieldErrors.confirmPassword = "Passwords do not match.";
  }

  if (currentPassword && newPassword && currentPassword === newPassword) {
    fieldErrors.newPassword =
      "New password must be different from current password.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return { ok: true, data: { currentPassword, newPassword } };
}

// ── Settings (Theme + Language) ─────────────────────────────────

export type SettingsField = "theme" | "language";

export interface NormalizedSettingsInput {
  language: LanguagePreference;
}

export type SettingsValidationResult =
  | { ok: true; data: NormalizedSettingsInput }
  | {
      ok: false;
      fieldErrors: Partial<Record<SettingsField, string>>;
      formError?: string;
    };

const VALID_LANGUAGES = Object.values(LanguagePreference) as string[];

export function validateSettingsInput(
  formData: FormData,
): SettingsValidationResult {
  const fieldErrors: Partial<Record<SettingsField, string>> = {};

  const rawTheme = getFormDataString(formData, "theme");
  const rawLanguage = getFormDataString(formData, "language");

  if (!VALID_LANGUAGES.includes(rawLanguage)) {
    fieldErrors.language = "Invalid language selection.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    data: {
      language: rawLanguage as LanguagePreference,
    },
  };
}
