import { VillageStatus } from "@prisma/client";

import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { CancelDeactivationForm } from "@/features/village-deactivation/components/cancel-deactivation-form";
import { DeactivationCountdown } from "@/features/village-deactivation/components/deactivation-countdown";
import { DeactivationNotificationsCard } from "@/features/village-deactivation/components/deactivation-notifications-card";
import { DeactivationStatusBadge } from "@/features/village-deactivation/components/deactivation-status-badge";
import { RequestDeactivationForm } from "@/features/village-deactivation/components/request-deactivation-form";
import {
  DEACTIVATION_ERROR_PARAM,
  DEACTIVATION_NOTICE_PARAM,
  DEACTIVATION_UNTIL_PARAM,
} from "@/features/village-deactivation/lib/deactivation-results";
import {
  getChiefDeactivationView,
  getNotificationsView,
} from "@/features/village-deactivation/lib/deactivation-queries";
import {
  fillTemplate,
  resolveFeedback,
  showCancelForm,
} from "@/features/village-deactivation/lib/deactivation-view";
import { getVillageShellContext } from "@/features/shell/lib/shell-context";
import { requireChief } from "@/lib/authz";
import { getT } from "@/lib/i18n/translations";
import { formatYangonDateTime } from "@/lib/utils";

export const metadata = {
  title: "Village Deactivation | Village Fund Collection System",
};

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/*
 * The Chief's page for the deactivation workflow. It is reachable in every
 * state, including while the village is read-only (that is where the Chief
 * cancels). What is shown here is a convenience: each action is checked again
 * on the server against the database.
 */
export default async function ChiefDeactivationPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { user, villageId } = await requireChief();
  const { language } = await getVillageShellContext();
  const t = getT(language);

  const query = (await searchParams) ?? {};
  const feedback = resolveFeedback(
    t,
    {
      error: firstValue(query[DEACTIVATION_ERROR_PARAM]),
      notice: firstValue(query[DEACTIVATION_NOTICE_PARAM]),
      until: firstValue(query[DEACTIVATION_UNTIL_PARAM]),
    },
    (date) => formatYangonDateTime(date),
  );

  const [view, notifications] = await Promise.all([
    getChiefDeactivationView(villageId),
    getNotificationsView(user.id),
  ]);
  const { open, lastResolved, villageStatus } = view;

  // One clock reading for the whole render; the countdown component ticks from it.
  const now = new Date();
  const canRequest =
    open === null && villageStatus === VillageStatus.ACTIVE;
  const cooldownEnd =
    lastResolved?.status === "REJECTED" &&
    lastResolved.cooldownEndsAt &&
    lastResolved.cooldownEndsAt.getTime() > now.getTime()
      ? lastResolved.cooldownEndsAt
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        description={t("deact.chief.description")}
        meta={
          open ? (
            <DeactivationStatusBadge status={open.status} t={t} />
          ) : undefined
        }
        title={t("deact.chief.title")}
      />

      {feedback ? <Alert tone={feedback.tone}>{feedback.message}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="space-y-6">
          {open?.status === "APPROVED" && open.scheduledDeactivationAt ? (
            <Card>
              <CardHeader className="pb-3 sm:pb-3">
                <CardTitle as="h2">
                  {t("deact.chief.approved.title")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <p className="text-sm text-muted-foreground">
                  {fillTemplate(t("deact.chief.approved.body"), {
                    approvedAt: open.approvedAt
                      ? formatYangonDateTime(open.approvedAt)
                      : "—",
                    deadline: formatYangonDateTime(open.scheduledDeactivationAt),
                  })}
                </p>
                <DeactivationCountdown
                  deadlineIso={open.scheduledDeactivationAt.toISOString()}
                  serverNowIso={now.toISOString()}
                />
                {showCancelForm(now, open.scheduledDeactivationAt) ? (
                  <div className="space-y-3 border-t pt-5">
                    <h3 className="text-sm font-semibold">
                      {t("deact.chief.cancel.title")}
                    </h3>
                    <CancelDeactivationForm
                      language={language}
                      requestId={open.id}
                    />
                  </div>
                ) : (
                  <Alert tone="warning">{t("deact.chief.cancel.closed")}</Alert>
                )}
              </CardContent>
            </Card>
          ) : null}

          {open?.status === "PENDING" ? (
            <Card>
              <CardHeader className="pb-3 sm:pb-3">
                <CardTitle as="h2">{t("deact.chief.pending.title")}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  {fillTemplate(t("deact.chief.pending.body"), {
                    date: formatYangonDateTime(open.createdAt),
                  })}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {canRequest ? (
            <Card>
              <CardHeader className="pb-3 sm:pb-3">
                <CardTitle as="h2">
                  {t("deact.chief.request.title")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {cooldownEnd ? (
                  <Alert tone="info">
                    {fillTemplate(t("deact.chief.cooldown"), {
                      date: formatYangonDateTime(cooldownEnd),
                    })}
                  </Alert>
                ) : null}
                <RequestDeactivationForm language={language} />
              </CardContent>
            </Card>
          ) : null}

          {open === null &&
          lastResolved &&
          lastResolved.status !== "COMPLETED" ? (
            <Card>
              <CardHeader className="pb-3 sm:pb-3">
                <CardTitle as="h2">
                  {lastResolved.status === "REJECTED"
                    ? t("deact.chief.rejected.title")
                    : t("deact.chief.cancelled.title")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                <p className="[overflow-wrap:anywhere]">
                  {fillTemplate(t("deact.chief.rejected.body"), {
                    reason:
                      (lastResolved.status === "REJECTED"
                        ? lastResolved.rejectionReason
                        : lastResolved.cancellationReason) ?? "—",
                  })}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <DeactivationNotificationsCard
          items={notifications.items}
          language={language}
          unread={notifications.unread}
        />
      </div>
    </div>
  );
}
