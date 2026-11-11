"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { DARK_MEDIA_QUERY, THEME_STORAGE_KEY, type ThemeMode } from "./theme";
import {
  applyTheme,
  getServerThemeMode,
  getThemeMode,
  refreshThemeFromStorage,
  setThemeMode,
  subscribeThemeMode,
} from "./theme-store";

/*
 * Keeps the page in sync with the theme preference after first paint. The
 * inline script in the root layout has already set the right class by then, so
 * this only handles what happens later: the OS theme changing while on
 * "System", the preference changing in another tab, and the browser
 * theme-color tags. It renders nothing of its own and adds no state.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    applyTheme(getThemeMode());

    const media = window.matchMedia(DARK_MEDIA_QUERY);
    const onSystemChange = () => {
      if (getThemeMode() === "system") {
        applyTheme("system");
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_STORAGE_KEY) {
        refreshThemeFromStorage();
      }
    };

    media.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return <>{children}</>;
}

/**
 * The current preference and a setter that stores and applies it.
 * Server render and hydration report "system"; the real value follows right
 * after hydration, so there is no hydration mismatch.
 */
export function useTheme(): {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
} {
  const mode = useSyncExternalStore(
    subscribeThemeMode,
    getThemeMode,
    getServerThemeMode,
  );
  return { mode, setMode: setThemeMode };
}
