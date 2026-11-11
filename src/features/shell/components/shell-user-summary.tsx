"use client";

import type { SessionUser } from "../../../lib/auth/auth.types";
import { useTranslation } from "../../../lib/i18n/provider";
import { Badge } from "../../../components/ui/badge";
import {
  getInitials,
  getMembershipLabel,
  getMembershipTone,
  getRoleLabel,
} from "../lib/shell-labels";

/** Account card shown at the top of the mobile menu sheet. */
export function ShellUserSummary({
  user,
  variant,
}: {
  user: SessionUser;
  variant: "platform" | "village";
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-base font-semibold text-accent-foreground"
      >
        {getInitials(user.name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-snug">{user.name}</p>
        <p className="text-xs text-muted-foreground">
          {getRoleLabel(t, user.role)}
        </p>
        {variant === "village" ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge
              dot
              variant={getMembershipTone(user.membershipStatus)}
            >
              {getMembershipLabel(t, user.membershipStatus)}
            </Badge>
          </div>
        ) : null}
      </div>
    </div>
  );
}