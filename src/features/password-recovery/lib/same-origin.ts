import "server-only";

import { headers } from "next/headers";

import { isSameOrigin } from "./origin-check";

/*
 * Defense in depth for the public recovery actions. Next.js already compares
 * the Origin header with the host for Server Actions; this repeats the check
 * where the stakes are highest, so a cross-site form post cannot start a
 * recovery request or guess a code on someone's behalf.
 *
 * A request with NO Origin header (some same-origin navigations) is allowed:
 * browsers always send Origin on cross-site POSTs, which is the case that
 * matters. When Origin is present it must match the Host the app was reached
 * on, or the first X-Forwarded-Host entry when behind a proxy.
 */

export async function requestIsSameOrigin(): Promise<boolean> {
  const requestHeaders = await headers();

  return isSameOrigin(
    requestHeaders.get("origin"),
    requestHeaders.get("host"),
    requestHeaders.get("x-forwarded-host"),
  );
}
