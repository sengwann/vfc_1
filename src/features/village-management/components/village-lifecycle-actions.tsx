import type { LanguagePreference } from "@prisma/client";
import { VillageStatus } from "@prisma/client";

import { Alert } from "@/components/ui/alert";
import { Field, Textarea } from "@/components/ui/field";
import type { TranslationKey } from "@/lib/i18n/en";
import { getT } from "@/lib/i18n/translations";
import { reactivateVillageAction } from "../actions/reactivate-village.action";
import { suspendVillageAction } from "../actions/suspend-village.action";
import { REASON_MAX_LENGTH } from "../lib/lifecycle-input";
import {
  canReactivateVillage,
  canSuspendVillage,
} from "../lib/village-lifecycle";
import { LifecycleSubmitButton } from "./lifecycle-submit-button";

const STATUS_DESCRIPTION_KEYS: Record<VillageStatus, TranslationKey> = {
  [VillageStatus.ACTIVE]: "adminVillages.statusDesc.active",
  [VillageStatus.SUSPENDED]: "adminVillages.statusDesc.suspended",
  [VillageStatus.DEACTIVATED]: "adminVillages.statusDesc.deactivated",
};

/*
 * Server component. Which actions appear is still decided by the
 * canSuspend/canReactivate rules; the actions and their `villageId` form field
 * are unchanged. Each action also accepts an optional `reason` (max
 * REASON_MAX_LENGTH characters) that is saved in the audit entry.
 * There is no deactivate action here: a village is deactivated only by the
 * deactivation workflow (Chief request, System Admin approval, countdown).
 */
export function VillageLifecycleActions({
  status,
  villageId,
  language,
}: {
  status: VillageStatus;
  villageId: string;
  language: LanguagePreference;
}) {
  const t = getT(language);

  if (status === VillageStatus.DEACTIVATED) {
    return <Alert tone="info">{t(STATUS_DESCRIPTION_KEYS[status])}</Alert>;
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        {t(STATUS_DESCRIPTION_KEYS[status])}
      </p>

      {canSuspendVillage(status) ? (
        <form action={suspendVillageAction} className="space-y-3">
          <input name="villageId" type="hidden" value={villageId} />
          <p className="text-sm text-muted-foreground">
            {t("adminVillages.suspend.hint")}
          </p>
          <Field
            hint={t("adminVillages.reason.hint")}
            id="suspend-reason"
            label={t("adminVillages.reason.label")}
          >
            <Textarea maxLength={REASON_MAX_LENGTH} name="reason" rows={2} />
          </Field>
          <LifecycleSubmitButton
            className="w-full border-warning-border bg-warning-soft text-warning-strong hover:bg-warning-soft active:bg-warning-soft"
            variant="outline"
          >
            {t("adminVillages.suspend.button")}
          </LifecycleSubmitButton>
        </form>
      ) : null}

      {canReactivateVillage(status) ? (
        <form action={reactivateVillageAction} className="space-y-3">
          <input name="villageId" type="hidden" value={villageId} />
          <p className="text-sm text-muted-foreground">
            {t("adminVillages.reactivate.hint")}
          </p>
          <Field
            hint={t("adminVillages.reason.hint")}
            id="reactivate-reason"
            label={t("adminVillages.reason.label")}
          >
            <Textarea maxLength={REASON_MAX_LENGTH} name="reason" rows={2} />
          </Field>
          <LifecycleSubmitButton className="w-full">
            {t("adminVillages.reactivate.button")}
          </LifecycleSubmitButton>
        </form>
      ) : null}
    </div>
  );
}
