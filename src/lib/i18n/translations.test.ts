import { describe, expect, it } from "vitest";
import { en, type TranslationKey } from "./en";
import { my } from "./my";
import { getT, getTranslation } from "./translations";

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe("translation dictionaries", () => {
  it("has the same English and Burmese keys", () => {
    expect(Object.keys(my).sort()).toEqual(Object.keys(en).sort());
  });

  it("keeps translations nonblank and preserves placeholders", () => {
    for (const key of Object.keys(en) as TranslationKey[]) {
      expect(en[key].trim(), `English: ${key}`).not.toBe("");
      expect(my[key].trim(), `Burmese: ${key}`).not.toBe("");
      expect(placeholders(my[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("looks up both languages through the translation helpers", () => {
    expect(getTranslation("EN", "nav.dashboard")).toBe(en["nav.dashboard"]);
    expect(getTranslation("MY", "nav.dashboard")).toBe(my["nav.dashboard"]);
    expect(getT("MY")("recovery.notices.title")).toBe(my["recovery.notices.title"]);
  });
});
