import { LanguagePreference } from "@prisma/client";
import { en, type TranslationKey } from "./en";
import { my } from "./my";

const translations: Record<
  LanguagePreference,
  Record<TranslationKey, string>
> = {
  EN: en,
  MY: my,
};

/**
 * Server-safe translation function.
 * Returns the translated string for the given language and key.
 * Falls back to English if the key is not found in the target language.
 */
export function getTranslation(
  language: LanguagePreference,
  key: TranslationKey,
): string {
  const dict = translations[language] ?? en;
  return dict[key] ?? en[key] ?? key;
}

export function getT(language: LanguagePreference) {
  return (key: TranslationKey): string => getTranslation(language, key);
}
