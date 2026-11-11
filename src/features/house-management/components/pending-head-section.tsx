"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { useTranslation } from "@/lib/i18n/provider";
import { cn, formatYangonDateTime } from "@/lib/utils";
import { interpolate, type PendingHeadCandidate } from "../lib/house-ui";
import { getPendingHeadText } from "../lib/pending-head-text";

/** Same shape the other forms use: <form action={serverAction}>. */
type FormAction = (formData: FormData) => void | Promise<void>;

/*
 * Two-step confirmation without client state: a native <details>, the same
 * approach as the household page. The hidden inputs carry the house and the
 * member; the server action re-checks everything.
 */
function ConfirmForm({
  action,
  houseId,
  memberId,
  triggerLabel,
  confirmLabel,
  body,
  tone,
}: {
  action: FormAction;
  houseId: string;
  memberId: string;
  triggerLabel: string;
  confirmLabel: string;
  body: string;
  tone: "primary" | "danger";
}) {
  const danger = tone === "danger";

  return (
    <details className="group">
      <summary
        className={cn(
          danger ? buttonVariants({ variant: "outline" }) : buttonVariants(),
          "w-full cursor-pointer list-none [&::-webkit-details-marker]:hidden",
          danger &&
            "border-danger-border text-danger-strong hover:bg-danger-soft",
        )}
      >
        {triggerLabel}
      </summary>
      <div
        className={cn(
          "mt-2 space-y-3 rounded-lg border p-3 text-sm",
          danger
            ? "border-danger-border bg-danger-soft/60 text-danger-strong"
            : "bg-muted text-foreground",
        )}
      >
        <p className="leading-relaxed">{body}</p>
        <form action={action}>
          <input name="houseId" type="hidden" value={houseId} />
          <input name="memberId" type="hidden" value={memberId} />
          <Button
            className="w-full"
            type="submit"
            variant={danger ? "destructive" : undefined}
          >
            {confirmLabel}
          </Button>
        </form>
      </div>
    </details>
  );
}

export function PendingHeadSection({
  houseId,
  candidates,
  canApprove,
  approveAction,
  rejectAction,
}: {
  houseId: string;
  candidates: PendingHeadCandidate[];
  /** False when the house is inactive: the Chief can only reject then. */
  canApprove: boolean;
  approveAction: FormAction;
  rejectAction: FormAction;
}) {
  const { t, language } = useTranslation();
  const text = getPendingHeadText(language);

  return (
    <Section
      actions={<Badge variant="warning">{candidates.length}</Badge>}
      description={text.description}
      id="pending-head"
      title={text.title}
    >
      {!canApprove ? <Alert tone="warning">{text.inactiveNote}</Alert> : null}

      <ul className="space-y-3">
        {candidates.map((candidate) => (
          <li key={candidate.id}>
            <Card className="border-warning-border">
              <CardContent className="space-y-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-snug">
                    {candidate.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {interpolate(text.registered, {
                      date: formatYangonDateTime(
                        new Date(candidate.createdAt),
                        "date",
                      ),
                    })}
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {canApprove ? (
                    <ConfirmForm
                      action={approveAction}
                      body={interpolate(text.approveConfirmBody, {
                        name: candidate.name,
                      })}
                      confirmLabel={text.approveConfirm}
                      houseId={houseId}
                      memberId={candidate.id}
                      tone="primary"
                      triggerLabel={text.approveTrigger}
                    />
                  ) : null}
                  <ConfirmForm
                    action={rejectAction}
                    body={interpolate(t("household.reject.confirmBody"), {
                      name: candidate.name,
                    })}
                    confirmLabel={t("household.reject.confirm")}
                    houseId={houseId}
                    memberId={candidate.id}
                    tone="danger"
                    triggerLabel={t("household.reject")}
                  />
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </Section>
  );
}