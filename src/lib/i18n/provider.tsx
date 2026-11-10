"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { LanguagePreference } from "@prisma/client";
import type { TranslationKey } from "./en";
import { getTranslation } from "./translations";

interface TranslationContextValue {
  language: LanguagePreference;
  t: (key: TranslationKey) => string;
}

const TranslationContext = createContext<TranslationContextValue>({
  language: "EN",
  t: (key) => key,
});

export function TranslationProvider({
  language,
  children,
}: {
  language: LanguagePreference;
  children: ReactNode;
}) {
  const t = (key: TranslationKey): string => getTranslation(language, key);

  return (
    <TranslationContext.Provider value={{ language, t }}>
      {children}
    </TranslationContext.Provider>
  );
}

export function useTranslation(): TranslationContextValue {
  return useContext(TranslationContext);
}
