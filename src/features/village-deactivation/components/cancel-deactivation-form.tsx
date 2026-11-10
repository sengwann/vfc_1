import type { LanguagePreference } from "@prisma/client";

import { Field, Textarea } from "@/components/ui/field";
import { getT } from "@/lib/i18n/translations";

import { cancelDeactivationRequestAction } from "../actions/cancel-deactivation-request.action";
import { DEACTIVATION_REASON_MAX_LENGTH } from "../lib/deactivation-input";
import { fillTemplate } from "../lib/deactivation-view";
import { DeactivationSubmitButton } from "./deactivation-submit-button";

export function CancelDeactivationForm({
  requestId,
  language,
}: {
  requestId: string;
  language: LanguagePreference;
}) {
  const t = getT(language);

  return (
    <form action={cancelDeactivationRequestAction} className="space-y-4">
      <input name="requestId" type="hidden" value={requestId} />
      <p className="text-sm text-muted-foreground">
        {t("deact.chief.cancel.hint")}
      </p>
      <Field
        hint={fillTemplate(t("deact.reason.hint"), {
          max: DEACTIVATION_REASON_MAX_LENGTH,
        })}
        id="cancel-reason"
        label={t("deact.reason.label")}
      >
        <Textarea
          maxLength={DEACTIVATION_REASON_MAX_LENGTH}
          name="reason"
          required
          rows={3}
        />
      </Field>
      <label className="flex min-h-11 items-start gap-3 text-sm">
        <input
          className="mt-1 size-4 shrink-0"
          name="confirm"
          required
          type="checkbox"
        />
        <span>{t("deact.chief.cancel.confirm")}</span>
      </label>
      <DeactivationSubmitButton className="w-full sm:w-auto">
        {t("deact.chief.cancel.button")}
      </DeactivationSubmitButton>
    </form>
  );
}
