import type { LanguagePreference } from "@prisma/client";

import { Field, Textarea } from "@/components/ui/field";
import { getT } from "@/lib/i18n/translations";

import { approveDeactivationRequestAction } from "../actions/approve-deactivation-request.action";
import { rejectDeactivationRequestAction } from "../actions/reject-deactivation-request.action";
import { DEACTIVATION_REASON_MAX_LENGTH } from "../lib/deactivation-input";
import { fillTemplate } from "../lib/deactivation-view";
import { DeactivationSubmitButton } from "./deactivation-submit-button";

/** Approve and reject for one PENDING request. Both are re-checked on the server. */
export function AdminRequestDecisionForms({
  requestId,
  language,
}: {
  requestId: string;
  language: LanguagePreference;
}) {
  const t = getT(language);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <form action={approveDeactivationRequestAction} className="space-y-3">
        <input name="requestId" type="hidden" value={requestId} />
        <p className="text-sm text-muted-foreground">
          {t("deact.admin.approveHint")}
        </p>
        <DeactivationSubmitButton className="w-full">
          {t("deact.admin.approve")}
        </DeactivationSubmitButton>
      </form>

      <form action={rejectDeactivationRequestAction} className="space-y-3">
        <input name="requestId" type="hidden" value={requestId} />
        <Field
          hint={fillTemplate(t("deact.reason.hint"), {
            max: DEACTIVATION_REASON_MAX_LENGTH,
          })}
          id={`reject-reason-${requestId}`}
          label={t("deact.admin.rejectReason")}
        >
          <Textarea
            maxLength={DEACTIVATION_REASON_MAX_LENGTH}
            name="reason"
            required
            rows={2}
          />
        </Field>
        <DeactivationSubmitButton className="w-full" variant="outline">
          {t("deact.admin.reject")}
        </DeactivationSubmitButton>
      </form>
    </div>
  );
}
