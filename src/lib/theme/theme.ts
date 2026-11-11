/*
 * Theme preference (Light / Dark / System).
 *
 * The preference is per device: it lives in localStorage and never touches the
 * account or the database. This file is pure (no React, no DOM access at import
 * time) so the server root layout and client code can both import it.
 *
 * How it works:
 *  - The `.dark` class on <html> switches the token set in globals.css.
 *  - THEME_INIT_SCRIPT runs inline in <head>, before the first paint, so the
 *    page never flashes the wrong theme.
 *  - theme-store.ts keeps the preference in sync after that (toggle clicks,
 *    OS changes while on "System", other tabs).
 */

export const THEME_MODES = ["light", "dark", "system"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];
export type ResolvedTheme = "light" | "dark";

/** localStorage key. Unknown or missing values mean "system". */
export const THEME_STORAGE_KEY = "vfc-theme";

export const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/** Browser UI colour (address bar / status bar) for each resolved theme. */
export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#166448",
  /* Same as the dark `--background` token. */
  dark: "#0b0f19",
};

export function parseThemeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" ? value : "system";
}

/*
 * Inline, blocking script for <head>. Each step is guarded on its own, so
 * blocked storage (private mode) or a missing matchMedia still resolves to a
 * sensible theme instead of throwing before first paint.
 */
export const THEME_INIT_SCRIPT = `(function(){var r=document.documentElement,m="system";try{var s=window.localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(s==="light"||s==="dark")m=s}catch(e){}var d=m==="dark";if(m==="system"){try{d=window.matchMedia(${JSON.stringify(
  DARK_MEDIA_QUERY,
)}).matches}catch(e){}}if(d){r.classList.add("dark")}else{r.classList.remove("dark")}})();`;
