import type { HouseErrorCode } from "./house-error-text";

export type HouseField = "houseNumber";

export interface NormalizedHouseInput {
  houseNumber: string;
}

export type HouseValidationResult =
  | { ok: true; data: NormalizedHouseInput }
  | {
      ok: false;
      fieldErrors: Partial<Record<HouseField, HouseErrorCode>>;
    };

// Latin letters, digits, Myanmar / Myanmar Extended-A / Extended-B blocks,
// whitespace and the separators - / . ( )
const ALLOWED_CHARS_REGEX =
  /^[A-Z0-9\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F\s\-\/\.\(\)]+$/i;

// At least one letter or digit in any script (covers Myanmar letters and
// Myanmar digits U+1040-1049). Marks and punctuation alone do not count.
const MEANINGFUL_CONTENT_REGEX = /[\p{L}\p{N}]/u;

export function normalizeHouseNumber(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase();
}

export function validateHouseNumber(raw: string): HouseValidationResult {
  const normalized = normalizeHouseNumber(raw);

  if (!normalized) {
    return { ok: false, fieldErrors: { houseNumber: "required" } };
  }

  if (normalized.length < 2 || normalized.length > 30) {
    return { ok: false, fieldErrors: { houseNumber: "length" } };
  }

  if (!ALLOWED_CHARS_REGEX.test(normalized)) {
    return { ok: false, fieldErrors: { houseNumber: "chars" } };
  }

  if (!MEANINGFUL_CONTENT_REGEX.test(normalized)) {
    return { ok: false, fieldErrors: { houseNumber: "noContent" } };
  }

  return { ok: true, data: { houseNumber: normalized } };
}
