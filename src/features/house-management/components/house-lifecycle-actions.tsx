"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Lock } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/provider";
import { deactivateHouseAction } from "../actions/deactivate-house.action";
import { reactivateHouseAction } from "../actions/reactivate-house.action";
import {
  getDeactivateBlockedKey,
  interpolate,
  type HouseRuleFlags,
  type RuleResult,
} from "../lib/house-ui";

interface HouseLifecycleActionsProps {
  houseId: string;
  houseNumber: string;
  isActive: boolean;
  /** Rule results computed on the server by house-rules.ts. */
  deactivate: RuleResult;
  reactivate: RuleResult;
  /** Used only to pick a translated explanation when an action is blocked. */
  flags: HouseRuleFlags;
}

/* Must live inside the <form> so useFormStatus can see the pending action. */
function SubmitButton({
  children,
  variant,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
}) {
  const { pending } = useFormStatus();

  return (
    <Button className="w-full" loading={pending} type="submit" variant={variant}>
      {children}
    </Button>
  );
}

export function HouseLifecycleActions({
  houseId,
  houseNumber,
  isActive,
  deactivate,
  reactivate,
  flags,
}: HouseLifecycleActionsProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  if (!isActive) {
    if (!reactivate.allowed) return null;

    return (
      <form
        action={reactivateHouseAction.bind(null, houseId)}
        className="space-y-2"
      >
        <SubmitButton>{t("houses.reactivate.button")}</SubmitButton>
        <p className="text-sm text-muted-foreground">
          {t("houses.reactivate.hint")}
        </p>
      </form>
    );
  }

  if (!deactivate.allowed) {
    const key = getDeactivateBlockedKey(flags);
    const message = key ? t(key) : deactivate.reason;

    return (
      <div className="space-y-3">
        <Button className="w-full" disabled variant="outline">
          <Lock aria-hidden />
          {t("houses.deactivate.button")}
        </Button>
        {message ? <Alert tone="info">{message}</Alert> : null}
      </div>
    );
  }

  if (!confirming) {
    return (
      <div className="space-y-2">
        <Button
          className="w-full border-danger-border text-danger-strong hover:bg-danger-soft active:bg-danger-soft"
          onClick={() => setConfirming(true)}
          type="button"
          variant="outline"
        >
          {t("houses.deactivate.button")}
        </Button>
        <p className="text-sm text-muted-foreground">
          {t("houses.deactivate.hint")}
        </p>
      </div>
    );
  }

  return (
    <Alert tone="warning" title={t("houses.deactivate.confirmTitle")}>
      <div className="space-y-3">
        <p>
          {interpolate(t("houses.deactivate.confirmBody"), {
            number: houseNumber,
          })}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            autoFocus
            className="sm:flex-1"
            onClick={() => setConfirming(false)}
            type="button"
            variant="outline"
          >
            {t("common.cancel")}
          </Button>
          <form
            action={deactivateHouseAction.bind(null, houseId)}
            className="sm:flex-1"
          >
            <SubmitButton variant="destructive">
              {t("houses.deactivate.confirm")}
            </SubmitButton>
          </form>
        </div>
      </div>
    </Alert>
  );
}