import type { Metadata, Viewport } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import "./globals.css";
import { APP_NAME } from "@/lib/env";
import { THEME_COLORS, THEME_INIT_SCRIPT } from "@/lib/theme/theme";
import { ThemeProvider } from "@/lib/theme/theme-provider";

export const metadata: Metadata = {
  title: {
    default: APP_NAME,
    template: `%s | ${APP_NAME}`,
  },
  description:
    "Multi-tenant village fund collection and household management system foundation.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Required for env(safe-area-inset-*) to work on notched phones.
  viewportFit: "cover",

  // Matches the OS theme on first paint; ThemeProvider then aligns these tags
  // with the user's saved Light / Dark / System choice.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

/*
 * Theme: the inline script (next/script, beforeInteractive) runs before the first paint and puts the
 * `dark` class on <html> from the saved preference (or the OS setting), so
 * there is no flash of the wrong theme. `suppressHydrationWarning` is required
 * on <html> because that script changes its class before React hydrates; it
 * only silences this one element, not its children.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground">
        {/* beforeInteractive: Next injects this into the HTML head and runs it
            before first paint and hydration, without React's "script tag in a
            component" warning. */}
        <Script
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
          id="vfc-theme-init"
          strategy="beforeInteractive"
        />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
