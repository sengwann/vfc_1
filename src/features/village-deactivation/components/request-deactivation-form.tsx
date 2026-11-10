import type { LanguagePreference } from "@prisma/client";

import { Alert } from "@/components/ui/alert";
import { Field, Textarea } from "@/components/ui/field";
import { getT } from "@/lib/i18n/translations";

import { submitDeactivationRequestAction } from "../actions/submit-deactivation-request.action";
import { DEACTIVATION_REASON_MAX_LENGTH } from "../lib/deactivation-input";
import { fillTemplate } from "../lib/deactivation-view";
import { DeactivationSubmitButton } from "./deactivation-submit-button";

export function RequestDeactivationForm({
  language,
}: {
  language: LanguagePreference;
}) {
  const t = getT(language);

  return (
    <form action={submitDeactivationRequestAction} className="space-y-4">
      <Alert tone="warning">{t("deact.chief.request.warning")}</Alert>
      <Field
        hint={fillTemplate(t("deact.reason.hint"), {
          max: DEACTIVATION_REASON_MAX_LENGTH,
        })}
        id="deactivation-reason"
        label={t("deact.reason.label")}
      >
        <Textarea
          maxLength={DEACTIVATION_REASON_MAX_LENGTH}
          name="reason"
          required
          rows={3}
        />
      </Field>
      <DeactivationSubmitButton className="w-full sm:w-auto">
        {t("deact.chief.request.submit")}
      </DeactivationSubmitButton>
    </form>
  );
}
