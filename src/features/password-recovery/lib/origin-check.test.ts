import { describe, expect, it } from "vitest";

import { isSameOrigin } from "./origin-check";

describe("isSameOrigin", () => {
  it("allows a request without an Origin header", () => {
    expect(isSameOrigin(null, "app.example.com", null)).toBe(true);
  });

  it("allows an Origin that matches the host", () => {
    expect(isSameOrigin("https://app.example.com", "app.example.com", null)).toBe(true);
    expect(isSameOrigin("https://APP.example.com", "app.example.com", null)).toBe(true);
  });

  it("allows an Origin that matches the first forwarded host", () => {
    expect(
      isSameOrigin("https://app.example.com", "internal:5000", "app.example.com, proxy"),
    ).toBe(true);
  });

  it("refuses a different site, a different port and garbage", () => {
    expect(isSameOrigin("https://evil.example", "app.example.com", null)).toBe(false);
    expect(isSameOrigin("https://app.example.com:8443", "app.example.com", null)).toBe(false);
    expect(isSameOrigin("not a url", "app.example.com", null)).toBe(false);
    expect(isSameOrigin("null", "app.example.com", null)).toBe(false);
  });

  it("refuses an Origin when no host is known", () => {
    expect(isSameOrigin("https://app.example.com", null, null)).toBe(false);
  });
});
