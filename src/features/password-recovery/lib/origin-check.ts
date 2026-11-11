/*
 * Pure origin comparison (no Next.js imports), so it can be unit tested.
 * See same-origin.ts for how it is used.
 *
 * A request with NO Origin header is allowed: browsers always send Origin on
 * cross-site POSTs, which is the case that matters. When Origin is present it
 * must match the Host the app was reached on, or the first X-Forwarded-Host
 * entry when behind a proxy.
 */

export function isSameOrigin(
  origin: string | null,
  host: string | null,
  forwardedHost: string | null,
): boolean {
  if (origin === null) {
    return true;
  }

  let originHost: string;

  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }

  const allowed = [host, forwardedHost?.split(",")[0]?.trim() ?? null]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  return allowed.includes(originHost);
}
