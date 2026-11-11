"use client";

import { useEffect, useState } from "react";

import { useTranslation } from "@/lib/i18n/provider";

import {
  computeCountdown,
  formatCountdown,
} from "../lib/deactivation-view";

/*
 * Live countdown to the stored deadline. Display only: the deadline is passed
 * in from the server and never recalculated here, and reaching zero does not
 * change anything by itself. The worker deactivates the village; the database
 * decides whether a cancel is still allowed.
 *
 * Rendered with the server's time first and ticking after mount, so the server
 * and browser output match and no hydration mismatch occurs.
 */
export function DeactivationCountdown({
  deadlineIso,
  serverNowIso,
}: {
  deadlineIso: string;
  serverNowIso: string;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => new Date(serverNowIso));

  useEffect(() => {
    // Offset from the server clock, so a wrong device clock does not skew it.
    const offset = new Date(serverNowIso).getTime() - Date.now();
    const timer = setInterval(() => setNow(new Date(Date.now() + offset)), 1000);

    return () => clearInterval(timer);
  }, [serverNowIso]);

  const countdown = computeCountdown(now, new Date(deadlineIso));

  return (
    <div>
      <p className="text-sm text-muted-foreground">
        {t("deact.countdown.label")}
      </p>
      {countdown.overdue ? (
        <p className="text-base font-semibold">{t("deact.countdown.overdue")}</p>
      ) : (
        <p
          aria-label={formatCountdown(countdown)}
          className="font-mono text-3xl font-semibold tabular-nums"
        >
          {formatCountdown(countdown)}
        </p>
      )}
    </div>
  );
}
