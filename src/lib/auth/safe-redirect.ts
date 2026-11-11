/*
 * Pure same-origin path check for post-login redirects. It has no imports so it
 * can be unit tested directly with the Node test runner.
 *
 * Browsers strip tab, CR and LF from URLs before parsing, so "/\t/evil.com"
 * becomes "//evil.com" (protocol-relative). Any control character is therefore
 * rejected outright instead of being trimmed or normalized.
 */

const MAX_REDIRECT_LENGTH = 2048;

// Rejects C0 controls, DEL, C1 controls, and the Unicode line/paragraph separators.
function containsForbiddenCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029
    ) {
      return true;
    }
  }
  return false;
}

const PLACEHOLDER_ORIGIN = "http://redirect-check.invalid";

function isLoginPath(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0].toLowerCase();
  return pathname.replace(/\/+$/, "") === "/login";
}

export function sanitizeRedirectPath(
  rawRedirect: string | null | undefined,
  fallback: string,
): string {
  if (typeof rawRedirect !== "string" || rawRedirect.length === 0) {
    return fallback;
  }

  if (containsForbiddenCharacter(rawRedirect)) {
    return fallback;
  }

  const path = rawRedirect.trim();

  if (path.length === 0 || path.length > MAX_REDIRECT_LENGTH) {
    return fallback;
  }

  if (!path.startsWith("/") || path.startsWith("//")) {
    return fallback;
  }

  if (path.includes("\\")) {
    return fallback;
  }

  if (isLoginPath(path)) {
    return fallback;
  }

  // Defense in depth: the path must still resolve to our own origin.
  try {
    if (new URL(path, PLACEHOLDER_ORIGIN).origin !== PLACEHOLDER_ORIGIN) {
      return fallback;
    }
  } catch {
    return fallback;
  }

  return path;
}
