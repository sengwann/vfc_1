import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ headers: vi.fn() }));

import { extractClientIp, parseTrustedProxyHops } from "./client-ip";

describe("extractClientIp", () => {
  it("takes the entry added by the nearest trusted proxy, not the leftmost", () => {
    expect(extractClientIp("1.1.1.1, 203.0.113.7", 1)).toBe("203.0.113.7");
  });

  it("supports more trusted hops", () => {
    expect(extractClientIp("203.0.113.7, 10.0.0.1", 2)).toBe("203.0.113.7");
  });

  it("returns null when hops is 0 (IP scoping disabled)", () => {
    expect(extractClientIp("203.0.113.7", 0)).toBeNull();
  });

  it("returns null for missing, empty or too-short headers", () => {
    expect(extractClientIp(null, 1)).toBeNull();
    expect(extractClientIp("", 1)).toBeNull();
    expect(extractClientIp("203.0.113.7", 2)).toBeNull();
  });

  it("returns null for values that are not IP addresses", () => {
    expect(extractClientIp("not-an-ip", 1)).toBeNull();
    expect(extractClientIp("1.1.1.1, <script>", 1)).toBeNull();
  });

  it("accepts IPv6 and strips an IPv4 port", () => {
    expect(extractClientIp("2001:DB8::1", 1)).toBe("2001:db8::1");
    expect(extractClientIp("203.0.113.7:4711", 1)).toBe("203.0.113.7");
  });
});

describe("parseTrustedProxyHops", () => {
  it("defaults to 1", () => {
    expect(parseTrustedProxyHops(undefined)).toBe(1);
    expect(parseTrustedProxyHops("")).toBe(1);
    expect(parseTrustedProxyHops("abc")).toBe(1);
    expect(parseTrustedProxyHops("-2")).toBe(1);
    expect(parseTrustedProxyHops("1.5")).toBe(1);
  });

  it("accepts 0 and clamps large values", () => {
    expect(parseTrustedProxyHops("0")).toBe(0);
    expect(parseTrustedProxyHops("2")).toBe(2);
    expect(parseTrustedProxyHops("99")).toBe(5);
  });
});
