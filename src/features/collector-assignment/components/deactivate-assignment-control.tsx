"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/provider";

export type DeactivateAssignmentAction = (
  formData: FormData,
) => void | Promise<void>;

function ConfirmActions({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button
        autoFocus
        className="w-full sm:w-auto"
        disabled={pending}
        onClick={onCancel}
        type="button"
        variant="outline"
      >
        {t("common.cancel")}
      </Button>
      <Button
        className="w-full sm:w-auto"
        loading={pending}
        type="submit"
        variant="destructive"
      >
        {pending
          ? t("collectors.deactivate.working")
          : t("collectors.deactivate.confirm")}
      </Button>
    </div>
  );
}

export function DeactivateAssignmentControl({
  assignmentId,
  collectorName,
  periodLabel,
  action,
}: {
  assignmentId: string;
  collectorName: string;
  periodLabel: string;
  action: DeactivateAssignmentAction;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button
        className="w-full border-danger-border text-danger-strong hover:bg-danger-soft active:bg-danger-soft sm:w-auto"
        onClick={() => setConfirming(true)}
        type="button"
        variant="outline"
      >
        {t("collectors.deactivate.button")}
      </Button>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input name="assignmentId" type="hidden" value={assignmentId} />
      <Alert title={t("collectors.deactivate.confirmTitle")} tone="warning">
        {t("collectors.deactivate.confirmBody")
          .replace("{name}", collectorName)
          .replace("{period}", periodLabel)}
      </Alert>
      <ConfirmActions onCancel={() => setConfirming(false)} />
    </form>
  );
}
