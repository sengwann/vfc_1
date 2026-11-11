"use client";

import { useId } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n/en";
import { useTranslation } from "@/lib/i18n/provider";
import type { ThemeMode } from "@/lib/theme/theme";
import { useTheme } from "@/lib/theme/theme-provider";
import { cn } from "@/lib/utils";

const OPTIONS: {
  value: ThemeMode;
  labelKey: TranslationKey;
  Icon: LucideIcon;
}[] = [
  { value: "light", labelKey: "theme.light", Icon: Sun },
  { value: "dark", labelKey: "theme.dark", Icon: Moon },
  { value: "system", labelKey: "theme.system", Icon: Monitor },
];

/*
 * Light / Dark / System choice. One component for every place the theme can be
 * changed (app header, phone menu, sign-in screens, Settings), so they always
 * look and behave the same and stay in sync through the shared theme store.
 *
 * It is a native radio group: arrow keys move and select, Tab enters and
 * leaves the group, and screen readers announce "Appearance" plus the options.
 * The selected option is shown by fill AND icon/label, never by colour alone.
 *
 *  - variant "labeled": three equal tiles with icon and text (Settings, menu).
 *  - variant "icon":    compact icons only; the text stays as the accessible
 *                       name (and a tooltip) for the header and sign-in screens.
 *
 * Pass `aria-labelledby` when a visible heading already names the group.
 */
export function ThemeToggle({
  variant = "labeled",
  className,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: {
  variant?: "labeled" | "icon";
  className?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const { t } = useTranslation();
  const { mode, setMode } = useTheme();
  const groupName = useId();
  const iconOnly = variant === "icon";

  return (
    <div
      aria-describedby={describedBy}
      aria-label={labelledBy ? undefined : t("settings.appearance")}
      aria-labelledby={labelledBy}
      className={cn(
        "rounded-lg border border-border-strong bg-card p-0.5 shadow-xs",
        iconOnly ? "inline-flex" : "grid grid-cols-3 gap-0.5",
        className,
      )}
      role="radiogroup"
    >
      {OPTIONS.map(({ value, labelKey, Icon }) => {
        const label = t(labelKey);
        const active = mode === value;

        return (
          <label
            className={cn(
              "flex cursor-pointer select-none items-center justify-center rounded-md text-sm font-semibold leading-snug transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
              iconOnly
                ? "size-10 pointer-coarse:size-11"
                : "min-h-14 flex-col gap-1 px-2 py-2 text-center",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            key={value}
            title={iconOnly ? label : undefined}
          >
            <input
              checked={active}
              className="sr-only"
              name={groupName}
              onChange={() => setMode(value)}
              type="radio"
              value={value}
            />
            <Icon
              aria-hidden
              className={cn("shrink-0", iconOnly ? "size-5" : "size-4")}
            />
            <span
              className={
                iconOnly ? "sr-only" : "min-w-0 [overflow-wrap:anywhere]"
              }
            >
              {label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
