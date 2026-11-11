"use client";

import { useSyncExternalStore } from "react";
import type { LanguagePreference } from "@prisma/client";

import { cn } from "../../../lib/utils";

/*
 * Visitors who are not signed in have no saved language preference (it lives
 * in the user's settings). This keeps a browser-only choice for the sign-in
 * screens. It never touches the account: after sign-in the app uses the
 * language saved in the user's settings, exactly as before.
 */
const STORAGE_KEY = "vfc-login-language";

let memoryLanguage: LanguagePreference | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function getSnapshot(): LanguagePreference {
  if (memoryLanguage) {
    return memoryLanguage;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "MY" ? "MY" : "EN";
  } catch {
    return "EN";
  }
}

function getServerSnapshot(): LanguagePreference {
  return "EN";
}

function setLanguage(language: LanguagePreference): void {
  memoryLanguage = language;
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Storage can be blocked (private mode); the in-memory choice still works.
  }
  listeners.forEach((listener) => listener());
}

export function useLoginLanguage(): LanguagePreference {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/* Language names are shown in their own language on purpose. */
const OPTIONS: { value: LanguagePreference; label: string; lang: string }[] = [
  { value: "EN", label: "English", lang: "en" },
  { value: "MY", label: "မြန်မာ", lang: "my" },
];

export function LoginLanguageSwitch({
  language,
  label,
}: {
  language: LanguagePreference;
  /** Translated accessible name of the group. */
  label: string;
}) {
  return (
    <div
      aria-label={label}
      className="inline-flex rounded-lg border border-border-strong bg-card p-0.5 shadow-xs"
      role="group"
    >
      {OPTIONS.map((option) => {
        const active = option.value === language;
        return (
          <button
            aria-pressed={active}
            className={cn(
              "min-h-10 rounded-md px-3.5 text-sm font-semibold leading-snug transition-colors pointer-coarse:min-h-11",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            key={option.value}
            lang={option.lang}
            onClick={() => setLanguage(option.value)}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
