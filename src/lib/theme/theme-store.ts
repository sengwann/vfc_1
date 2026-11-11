import {
  DARK_MEDIA_QUERY,
  THEME_COLORS,
  THEME_STORAGE_KEY,
  parseThemeMode,
  type ResolvedTheme,
  type ThemeMode,
} from "./theme";

/*
 * Browser-side theme store: reads and writes the stored preference, applies it
 * to <html>, and lets React components subscribe through useSyncExternalStore
 * (see theme-provider.tsx). Same approach as the sign-in language switch.
 *
 * Only call these from the browser. Nothing here runs at import time.
 */

let cachedMode: ThemeMode | null = null;
const listeners = new Set<() => void>();

function readStoredMode(): ThemeMode {
  try {
    return parseThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Storage can be blocked; fall back to following the system.
    return "system";
  }
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function getThemeMode(): ThemeMode {
  if (cachedMode === null) {
    cachedMode = readStoredMode();
  }
  return cachedMode;
}

/** The server (and the hydration pass) always render the "system" state. */
export function getServerThemeMode(): ThemeMode {
  return "system";
}

export function subscribeThemeMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== "system") {
    return mode;
  }
  return typeof window.matchMedia === "function" &&
    window.matchMedia(DARK_MEDIA_QUERY).matches
    ? "dark"
    : "light";
}

/** Puts the resolved theme on <html> and on the browser theme-color tags. */
export function applyTheme(mode: ThemeMode): void {
  const resolved = resolveTheme(mode);
  document.documentElement.classList.toggle("dark", resolved === "dark");

  const metas = document.querySelectorAll<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  metas.forEach((meta) => {
    meta.content = THEME_COLORS[resolved];
  });
}

/*
 * Many components animate colours with `transition-colors`. Without this, a
 * theme switch would fade some surfaces and snap others, so transitions are
 * switched off for the moment of the change.
 */
function withoutTransitions(change: () => void): void {
  const style = document.createElement("style");
  style.appendChild(
    document.createTextNode("*,*::before,*::after{transition:none!important}"),
  );
  document.head.appendChild(style);

  change();

  // Force a style recalculation so the change lands without animating.
  window.getComputedStyle(document.body).getPropertyValue("opacity");
  window.setTimeout(() => style.remove(), 1);
}

export function setThemeMode(mode: ThemeMode): void {
  cachedMode = mode;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage can be blocked; the choice still applies for this session.
  }
  withoutTransitions(() => applyTheme(mode));
  notify();
}

/** Re-reads the stored value (another tab changed it) and applies it. */
export function refreshThemeFromStorage(): void {
  cachedMode = null;
  applyTheme(getThemeMode());
  notify();
}
