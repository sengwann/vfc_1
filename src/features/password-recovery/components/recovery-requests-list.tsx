import type { LanguagePreference } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { getT } from "@/lib/i18n/translations";
import { formatYangonDateTime } from "@/lib/utils";

import {
  rejectRecoveryRequestAction,
  withdrawRecoveryCodeAction,
} from "../actions/decide-recovery-request.action";
import type { RecoveryRequestView } from "../lib/recovery-queries";
import {
  RECOVERY_STATUS_KEYS,
  RECOVERY_STATUS_TONES,
  fillTemplate,
} from "../lib/recovery-view";
import { IssueCodeForm } from "./issue-code-form";

/*
 * The list is a convenience: what is shown here (including which buttons) is
 * decided again on the server for every action, from the database.
 */
export function RecoveryRequestsList({
  views,
  language,
}: {
  views: RecoveryRequestView[];
  language: LanguagePreference;
}) {
  const t = getT(language);

  if (views.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("recovery.approver.empty")}
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {views.map((view) => (
        <li key={view.id}>
          <Card>
            <CardHeader className="pb-3 sm:pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle as="h2">
                  <span className="[overflow-wrap:anywhere]">
                    {view.targetName}
                  </span>
                </CardTitle>
                <Badge variant={RECOVERY_STATUS_TONES[view.status] ?? "neutral"}>
                  {t(RECOVERY_STATUS_KEYS[view.status] ?? "recovery.status.pending")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1 text-sm text-muted-foreground">
                {view.actingAs === "SYSTEM_ADMIN" && view.villageCode ? (
                  <p>
                    {fillTemplate(t("recovery.approver.village"), {
                      code: view.villageCode,
                    })}
                  </p>
                ) : null}
                <p>
                  {fillTemplate(t("recovery.approver.requestedAt"), {
                    date: formatYangonDateTime(view.createdAt),
                  })}
                </p>
                {view.status === "PENDING" ? (
                  <p>
                    {fillTemplate(t("recovery.approver.requestExpires"), {
                      date: formatYangonDateTime(view.requestExpiresAt),
                    })}
                  </p>
                ) : null}
                {view.status === "CODE_ISSUED" && view.codeExpiresAt ? (
                  <p>
                    {fillTemplate(t("recovery.approver.codeExpires"), {
                      date: formatYangonDateTime(view.codeExpiresAt),
                    })}
                  </p>
                ) : null}
                {view.issueCount > 0 ? (
                  <p>
                    {fillTemplate(t("recovery.approver.issuedCount"), {
                      n: view.issueCount,
                    })}
                  </p>
                ) : null}
                {view.rejectionNote ? (
                  <p className="[overflow-wrap:anywhere]">
                    {fillTemplate(t("recovery.approver.rejectionNote"), {
                      note: view.rejectionNote,
                    })}
                  </p>
                ) : null}
                {view.revocationNote ? (
                  <p className="[overflow-wrap:anywhere]">
                    {fillTemplate(t("recovery.approver.revocationNote"), {
                      note: view.revocationNote,
                    })}
                  </p>
                ) : null}
              </div>

              {view.canIssue ? (
                <div className="space-y-3 border-t pt-4">
                  <h3 className="text-sm font-semibold">
                    {view.status === "CODE_ISSUED"
                      ? t("recovery.issue.reissueTitle")
                      : t("recovery.issue.title")}
                  </h3>
                  <IssueCodeForm
                    reissue={view.status === "CODE_ISSUED"}
                    requestId={view.id}
                  />
                </div>
              ) : null}

              {view.canReject ? (
                <form
                  action={rejectRecoveryRequestAction}
                  className="space-y-3 border-t pt-4"
                >
                  <h3 className="text-sm font-semibold">
                    {t("recovery.reject.title")}
                  </h3>
                  <input name="requestId" type="hidden" value={view.id} />
                  <Field
                    hint={t("recovery.reject.hint")}
                    id={`reject-note-${view.id}`}
                    label={t("recovery.reject.note")}
                  >
                    <Input maxLength={200} name="note" type="text" />
                  </Field>
                  <Button type="submit" variant="outline">
                    {t("recovery.reject.submit")}
                  </Button>
                </form>
              ) : null}

              {view.canWithdraw ? (
                <form
                  action={withdrawRecoveryCodeAction}
                  className="space-y-3 border-t pt-4"
                >
                  <h3 className="text-sm font-semibold">
                    {t("recovery.withdraw.title")}
                  </h3>
                  <input name="requestId" type="hidden" value={view.id} />
                  <Field
                    hint={t("recovery.withdraw.hint")}
                    id={`withdraw-note-${view.id}`}
                    label={t("recovery.withdraw.note")}
                    required
                  >
                    <Input maxLength={200} name="note" required type="text" />
                  </Field>
                  <Button type="submit" variant="outline">
                    {t("recovery.withdraw.submit")}
                  </Button>
                </form>
              ) : null}
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
