import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getPlatformShellContext } from "@/features/shell/lib/shell-context";
import { AdminRequestDecisionForms } from "@/features/village-deactivation/components/admin-request-decision-forms";
import { DeactivationCountdown } from "@/features/village-deactivation/components/deactivation-countdown";
import { DeactivationNotificationsCard } from "@/features/village-deactivation/components/deactivation-notifications-card";
import { DeactivationStatusBadge } from "@/features/village-deactivation/components/deactivation-status-badge";
import {
  getNotificationsView,
  listAdminDeactivationRequests,
} from "@/features/village-deactivation/lib/deactivation-queries";
import {
  DEACTIVATION_ERROR_PARAM,
  DEACTIVATION_NOTICE_PARAM,
  DEACTIVATION_UNTIL_PARAM,
} from "@/features/village-deactivation/lib/deactivation-results";
import {
  fillTemplate,
  resolveFeedback,
} from "@/features/village-deactivation/lib/deactivation-view";
import { getT } from "@/lib/i18n/translations";
import { formatYangonDateTime } from "@/lib/utils";

export const metadata = {
  title: "Deactivation Requests | Village Fund Collection System",
};

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/*
 * System Admin overview of deactivation requests. Approve and reject are
 * re-checked on the server (System Admin, request state, village state).
 */
export default async function DeactivationRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const { user, language } = await getPlatformShellContext();
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

  const [{ open, recent }, notifications] = await Promise.all([
    listAdminDeactivationRequests(),
    getNotificationsView(user.id),
  ]);
  const now = new Date();

  return (
    <div className="space-y-6">
      <PageHeader
        description={t("deact.admin.description")}
        title={t("deact.admin.title")}
      />

      {feedback ? <Alert tone={feedback.tone}>{feedback.message}</Alert> : null}

      <section aria-labelledby="open-requests" className="space-y-3">
        <h2 className="text-lg font-semibold" id="open-requests">
          {t("deact.admin.open")}
        </h2>

        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("deact.admin.empty")}
          </p>
        ) : (
          open.map((request) => {
            const deadline = request.scheduledDeactivationAt;
            const overdue =
              request.status === "APPROVED" &&
              deadline !== null &&
              deadline.getTime() <= now.getTime();

            return (
              <Card key={request.id}>
                <CardHeader className="pb-3 sm:pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle as="h3">
                      {request.village.villageCode} — {request.village.name}
                    </CardTitle>
                    <DeactivationStatusBadge status={request.status} t={t} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1 text-sm">
                    <p className="text-muted-foreground">
                      {fillTemplate(t("deact.admin.requestedBy"), {
                        name: request.requester.name,
                        date: formatYangonDateTime(request.createdAt),
                      })}
                    </p>
                    <p className="[overflow-wrap:anywhere]">
                      <span className="font-medium">
                        {t("deact.reason.label")}:
                      </span>{" "}
                      {request.reason}
                    </p>
                  </div>

                  {request.status === "PENDING" ? (
                    <AdminRequestDecisionForms
                      language={language}
                      requestId={request.id}
                    />
                  ) : null}

                  {request.status === "APPROVED" && deadline ? (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        {request.approvedAt
                          ? fillTemplate(t("deact.admin.approvedAt"), {
                              date: formatYangonDateTime(request.approvedAt),
                            })
                          : null}{" "}
                        · {t("deact.deadline")}: {formatYangonDateTime(deadline)}
                      </p>
                      <DeactivationCountdown
                        deadlineIso={deadline.toISOString()}
                        serverNowIso={now.toISOString()}
                      />
                      {overdue ? (
                        <Alert tone="warning">{t("deact.admin.overdue")}</Alert>
                      ) : null}
                      {request.lastProcessingError ? (
                        <Alert tone="danger">
                          {fillTemplate(t("deact.admin.processingError"), {
                            error: request.lastProcessingError,
                          })}
                        </Alert>
                      ) : null}
                    </div>
                  ) : null}

                  <Link
                    className="inline-block text-sm font-medium underline"
                    href={`/admin/villages/${request.village.id}`}
                  >
                    {t("deact.admin.viewVillage")}
                  </Link>
                </CardContent>
              </Card>
            );
          })
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <section aria-labelledby="recent-requests" className="space-y-3">
          <h2 className="text-lg font-semibold" id="recent-requests">
            {t("deact.admin.recent")}
          </h2>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("deact.admin.recentEmpty")}
            </p>
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {recent.map((request) => {
                const decidedAt =
                  request.completedAt ??
                  request.cancelledAt ??
                  request.rejectedAt ??
                  request.createdAt;
                const decisionReason =
                  request.rejectionReason ?? request.cancellationReason;

                return (
                  <li className="space-y-1 p-3 text-sm" key={request.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {request.village.villageCode} — {request.village.name}
                      </span>
                      <DeactivationStatusBadge status={request.status} t={t} />
                      <time
                        className="text-xs text-muted-foreground"
                        dateTime={decidedAt.toISOString()}
                      >
                        {formatYangonDateTime(decidedAt)}
                      </time>
                    </div>
                    {decisionReason ? (
                      <p className="text-muted-foreground [overflow-wrap:anywhere]">
                        {decisionReason}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <DeactivationNotificationsCard
          items={notifications.items}
          language={language}
          unread={notifications.unread}
        />
      </div>
    </div>
  );
}
