import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getOpenDeactivationRequest } from "@/features/village-deactivation/lib/deactivation-queries";
import { getPlatformShellContext } from "@/features/shell/lib/shell-context";
import { VillageLifecycleActions } from "@/features/village-management/components/village-lifecycle-actions";
import { VillageStatusBadge } from "@/features/village-management/components/village-status-badge";
import {
  LIFECYCLE_ERROR_BUSY,
  LIFECYCLE_ERROR_DEACTIVATION_COUNTDOWN,
  LIFECYCLE_ERROR_PARAM,
  LIFECYCLE_ERROR_REASON_TOO_LONG,
} from "@/features/village-management/lib/lifecycle-input";
import { requireVillageLifecycleAccess } from "@/lib/authz";
import type { TranslationKey } from "@/lib/i18n/en";
import { getT } from "@/lib/i18n/translations";
import { formatYangonDateTime } from "@/lib/utils";

export const metadata = {
  title: "Village Detail | Village Fund Collection System",
};

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

export default async function VillageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ villageId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { villageId } = await params;

  if (!villageId) {
    notFound();
  }

  const village = await requireVillageLifecycleAccess(villageId);
  const { language } = await getPlatformShellContext();
  const t = getT(language);

  const openDeactivation = await getOpenDeactivationRequest(village.id);

  const query = (await searchParams) ?? {};
  const errorParam = firstValue(query[LIFECYCLE_ERROR_PARAM]);
  const showReasonTooLong = errorParam === LIFECYCLE_ERROR_REASON_TOO_LONG;
  const showActiveFund = errorParam === "active_fund_exists";
  const showBusy = errorParam === LIFECYCLE_ERROR_BUSY;
  const showCountdown =
    errorParam === LIFECYCLE_ERROR_DEACTIVATION_COUNTDOWN;

  const statusLabels: Record<typeof village.status, TranslationKey> = {
    ACTIVE: "adminDashboard.status.active",
    SUSPENDED: "adminDashboard.status.suspended",
    DEACTIVATED: "adminDashboard.status.deactivated",
  };

  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: t("adminVillages.detail.code"),
      value: village.villageCode,
    },
    {
      label: t("adminVillages.detail.name"),
      value: village.name,
    },
    {
      label: t("adminVillages.detail.status"),
      value: (
        <VillageStatusBadge
          label={t(statusLabels[village.status])}
          status={village.status}
        />
      ),
    },
    {
      label: t("adminVillages.detail.createdAt"),
      value: (
        <time dateTime={village.createdAt.toISOString()}>
          {formatYangonDateTime(village.createdAt)}
        </time>
      ),
    },
    {
      label: t("adminVillages.detail.updatedAt"),
      value: (
        <time dateTime={village.updatedAt.toISOString()}>
          {formatYangonDateTime(village.updatedAt)}
        </time>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/admin/villages"
        backLabel={t("adminVillages.back")}
        eyebrow={village.villageCode}
        meta={
          <VillageStatusBadge
            label={t(statusLabels[village.status])}
            status={village.status}
          />
        }
        title={village.name}
      />

      {showReasonTooLong ? (
        <Alert tone="danger">{t("adminVillages.err.reasonTooLong")}</Alert>
      ) : null}

      {showBusy ? (
        <Alert tone="danger">{t("adminVillages.err.retry")}</Alert>
      ) : null}

      {showActiveFund && <Alert tone="danger">{t("deact.err.active_fund_exists")}</Alert>}
      {showCountdown ? (
        <Alert tone="danger">{t("adminVillages.err.deactivationCountdown")}</Alert>
      ) : null}

      {openDeactivation ? (
        <Alert
          action={
            <Link
              className="text-sm font-semibold underline"
              href="/admin/deactivation-requests"
            >
              {t("deact.admin.viewRequests")}
            </Link>
          }
          tone="warning"
        >
          {t(
            openDeactivation.status === "APPROVED"
              ? "shell.attention.deactivationApproved"
              : "shell.attention.deactivationPending",
          )}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader className="pb-3 sm:pb-3">
            <CardTitle as="h2">{t("adminVillages.detail.infoTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y text-sm">
              {rows.map((row) => (
                <div
                  className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5"
                  key={row.label}
                >
                  <dt className="shrink-0 text-muted-foreground">
                    {row.label}
                  </dt>
                  <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3 sm:pb-3">
            <CardTitle as="h2">
              {t("adminVillages.detail.lifecycleTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <VillageLifecycleActions
              language={language}
              status={village.status}
              villageId={village.id}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
