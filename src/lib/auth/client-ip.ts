import "server-only";

import { headers } from "next/headers";
import { isIP } from "node:net";

/*
 * Client IP for throttling. X-Forwarded-For is client-controllable on its left
 * side; every proxy appends the address it saw on the right. We therefore take
 * the entry `trustedHops` positions from the RIGHT, never the leftmost one.
 *
 * AUTH_TRUSTED_PROXY_HOPS (default 1) = number of proxies you trust between the
 * internet and the app. Set 0 to disable IP scoping entirely (identifier
 * throttling still applies). If it is set too low, every visitor appears to
 * share one proxy IP and the IP-wide limit would throttle everybody: verify it
 * on the deployed app before relying on it.
 */

const DEFAULT_TRUSTED_PROXY_HOPS = 1;
const MAX_TRUSTED_PROXY_HOPS = 5;

export function parseTrustedProxyHops(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_TRUSTED_PROXY_HOPS;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    return DEFAULT_TRUSTED_PROXY_HOPS;
  }
  return Math.min(value, MAX_TRUSTED_PROXY_HOPS);
}

export function extractClientIp(
  forwardedFor: string | null | undefined,
  trustedHops: number,
): string | null {
  if (trustedHops < 1 || !forwardedFor) return null;

  const entries = forwardedFor
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const candidate = entries[entries.length - trustedHops];
  if (!candidate) return null;

  // Tolerate "1.2.3.4:5678".
  const withoutPort = /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(candidate)
    ? candidate.slice(0, candidate.lastIndexOf(":"))
    : candidate;

  return isIP(withoutPort) ? withoutPort.toLowerCase() : null;
}

export async function getClientIp(): Promise<string | null> {
  const requestHeaders = await headers();
  return extractClientIp(
    requestHeaders.get("x-forwarded-for"),
    parseTrustedProxyHops(process.env.AUTH_TRUSTED_PROXY_HOPS),
  );
}
