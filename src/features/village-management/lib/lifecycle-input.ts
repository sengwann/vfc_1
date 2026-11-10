/*
 * Pure parsing of the lifecycle form fields (`villageId`, optional `reason`).
 * No imports, so it can be unit tested directly with the Node test runner.
 *
 * Village ids are cuid() values (not UUIDs), so only a sanity bound is applied
 * here. Whether the village exists is decided by the database lookup.
 */

export const VILLAGE_ID_MAX_LENGTH = 64;

export const REASON_MAX_LENGTH = 200;

/** Query-string contract between the lifecycle actions and the detail page. */
export const LIFECYCLE_ERROR_PARAM = "error";
export const LIFECYCLE_ERROR_REASON_TOO_LONG = "reason_too_long";
/** A serialization conflict that survived all retries. */
export const LIFECYCLE_ERROR_BUSY = "busy";
/** Suspend refused while a deactivation countdown is running. */
export const LIFECYCLE_ERROR_DEACTIVATION_COUNTDOWN = "deactivation_countdown";

export function parseVillageId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const villageId = value.trim();

  if (villageId.length === 0 || villageId.length > VILLAGE_ID_MAX_LENGTH) {
    return null;
  }

  return villageId;
}

export type ParsedReason =
  | {
      ok: true;
      /** Trimmed reason, or null when the field is missing or empty. */
      reason: string | null;
    }
  | {
      ok: false;
    };

export function parseReason(value: unknown): ParsedReason {
  if (typeof value !== "string") {
    return { ok: true, reason: null };
  }

  const reason = value.trim();

  if (reason.length === 0) {
    return { ok: true, reason: null };
  }

  // Count code points so an emoji is one character, not two.
  if (Array.from(reason).length > REASON_MAX_LENGTH) {
    return { ok: false };
  }

  return { ok: true, reason };
}

export type LifecycleInput =
  | {
      ok: true;
      villageId: string;
      reason: string | null;
    }
  | {
      ok: false;
      error: "INVALID_VILLAGE_ID";
    }
  | {
      ok: false;
      error: "REASON_TOO_LONG";
      villageId: string;
    };

export function parseLifecycleInput(formData: FormData): LifecycleInput {
  const villageId = parseVillageId(formData.get("villageId"));

  if (!villageId) {
    return { ok: false, error: "INVALID_VILLAGE_ID" };
  }

  const reason = parseReason(formData.get("reason"));

  if (!reason.ok) {
    return { ok: false, error: "REASON_TOO_LONG", villageId };
  }

  return { ok: true, villageId, reason: reason.reason };
}
