import "server-only";

import {
  AUTH_INVALID_CREDENTIALS_MESSAGE,
  DEFAULT_POST_LOGIN_ROUTE,
} from "./auth.constants";
import {
  IDENTIFIER_MAX_LENGTH,
  normalizeEmail,
  normalizePhone,
} from "./identifiers";
import { sanitizeRedirectPath } from "./safe-redirect";

/** Shape of a normalized village code. Shared with password recovery. */
export const VILLAGE_CODE_REGEX = /^[A-Z0-9]{3,20}$/;

export type NormalizedIdentifier =
  | {
      type: "email";
      value: string;
    }
  | {
      type: "phone";
      value: string;
    };

export function normalizeIdentifier(
  rawIdentifier: string,
): NormalizedIdentifier | null {
  const identifier = rawIdentifier.trim();

  if (!identifier || identifier.length > IDENTIFIER_MAX_LENGTH) {
    return null;
  }

  if (identifier.includes("@")) {
    const email = normalizeEmail(identifier);

    return email ? { type: "email", value: email } : null;
  }

  const phone = normalizePhone(identifier);

  return phone ? { type: "phone", value: phone } : null;
}

/** Same normalization as registration and village creation use. */
export function normalizeLoginVillageCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export type LoginValidationResult =
  | {
      ok: true;
      data: {
        identifier: NormalizedIdentifier;
        password: string;
        /**
         * Village the account belongs to. null means a platform administrator
         * sign-in: only accounts with the SYSTEM_ADMIN role and no village are
         * considered.
         */
        villageCode: string | null;
        redirectTo?: string;
      };
    }
  | {
      ok: false;
      error: string;
    };

export function validateLoginInput(input: {
  identifier?: unknown;
  password?: unknown;
  villageCode?: unknown;
  redirectTo?: unknown;
}): LoginValidationResult {
  const identifier =
    typeof input.identifier === "string" ? input.identifier : "";

  const password = typeof input.password === "string" ? input.password : "";

  const rawVillageCode =
    typeof input.villageCode === "string" ? input.villageCode : "";

  const redirectTo =
    typeof input.redirectTo === "string" && input.redirectTo.length > 0
      ? input.redirectTo
      : undefined;

  const invalidResult: LoginValidationResult = {
    ok: false,
    error: AUTH_INVALID_CREDENTIALS_MESSAGE,
  };

  if (!identifier || !password) {
    return invalidResult;
  }

  const normalizedIdentifier = normalizeIdentifier(identifier);

  if (!normalizedIdentifier) {
    return invalidResult;
  }

  if (password.length > 200) {
    return invalidResult;
  }

  // A blank code is the platform administrator sign-in. A code that is not
  // blank must look like a village code; anything else cannot match a village.
  let villageCode: string | null = null;
  if (rawVillageCode.trim()) {
    villageCode = normalizeLoginVillageCode(rawVillageCode);

    if (!VILLAGE_CODE_REGEX.test(villageCode)) {
      return invalidResult;
    }
  }

  return {
    ok: true,
    data: {
      identifier: normalizedIdentifier,
      password,
      villageCode,
      redirectTo,
    },
  };
}

export function getSafeRedirectPath(rawRedirect?: string): string {
  return sanitizeRedirectPath(rawRedirect, DEFAULT_POST_LOGIN_ROUTE);
}
