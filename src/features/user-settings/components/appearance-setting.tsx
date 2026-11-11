"use client";

import { useId } from "react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useTranslation } from "@/lib/i18n/provider";

/*
 * Settings > Preferences > Appearance. The same ThemeToggle used elsewhere in
 * the app, with a visible heading and a note. Changes apply immediately and
 * are saved on this device only, so there is no Save button and no server
 * action involved.
 */
export function AppearanceSetting() {
  const { t } = useTranslation();
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium" id={labelId}>
          {t("settings.appearance")}
        </p>
        <p className="text-sm text-muted-foreground" id={hintId}>
          {t("settings.appearanceHint")}
        </p>
      </div>
      <ThemeToggle aria-describedby={hintId} aria-labelledby={labelId} />
    </div>
  );
}
