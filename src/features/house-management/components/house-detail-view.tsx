"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { useTranslation } from "@/lib/i18n/provider";
import { formatYangonDateTime } from "@/lib/utils";
import {
  interpolate,
  type HouseDetailData,
  type HouseDetailRules,
  type PendingHeadCandidate,
} from "../lib/house-ui";
import { EditHouseLink } from "./edit-house-link";
import { HouseLifecycleActions } from "./house-lifecycle-actions";
import { HouseStatusBadge } from "./house-status-badge";
import { PendingHeadSection } from "./pending-head-section";

/** Same shape the other forms use: <form action={serverAction}>. */
type FormAction = (formData: FormData) => void | Promise<void>;

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium sm:text-end">
        {children}
      </dd>
    </div>
  );
}

export function HouseDetailView({
  house,
  rules,
  pendingHeadCandidates = [],
  chiefApproveAction,
  chiefRejectAction,
}: {
  house: HouseDetailData;
  rules: HouseDetailRules;
  /** Pending members of a headless house. Empty when the house has a head. */
  pendingHeadCandidates?: PendingHeadCandidate[];
  chiefApproveAction?: FormAction;
  chiefRejectAction?: FormAction;
}) {
  const { t } = useTranslation();
  const showLifecycle = house.isActive || rules.reactivate.allowed;
  const showPendingHead =
    pendingHeadCandidates.length > 0 &&
    Boolean(chiefApproveAction) &&
    Boolean(chiefRejectAction);

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/village/houses"
        backLabel={t("houses.back")}
        description={t("houses.detail.description")}
        meta={<HouseStatusBadge isActive={house.isActive} />}
        title={interpolate(t("houses.detail.title"), {
          number: house.houseNumber,
        })}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:items-start">
        <div className="space-y-4">
          {showPendingHead && chiefApproveAction && chiefRejectAction ? (
            <PendingHeadSection
              approveAction={chiefApproveAction}
              canApprove={house.isActive}
              candidates={pendingHeadCandidates}
              houseId={house.id}
              rejectAction={chiefRejectAction}
            />
          ) : null}

          <dl className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <dt className="text-sm text-muted-foreground">
                {t("houses.detail.members")}
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">
                {house.memberCount}
              </dd>
            </Card>
            <Card className="p-4">
              <dt className="text-sm text-muted-foreground">
                {t("houses.detail.payments")}
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">
                {house.paymentCount}
              </dd>
            </Card>
          </dl>

          <Card>
            <CardHeader>
              <CardTitle as="h2">{t("houses.detail.infoTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border">
                <InfoRow label={t("houses.detail.head")}>
                  {house.headOfHouseName ?? t("houses.detail.noHead")}
                </InfoRow>
                <InfoRow label={t("houses.detail.created")}>
                  {formatYangonDateTime(new Date(house.createdAt), "date")}
                </InfoRow>
                <InfoRow label={t("houses.detail.updated")}>
                  {formatYangonDateTime(new Date(house.updatedAt), "date")}
                </InfoRow>
              </dl>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle as="h2">{t("houses.detail.actionsTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <EditHouseLink editRules={rules.edit} houseId={house.id} />
            </CardContent>
          </Card>

          {showLifecycle ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2">
                  {t("houses.detail.lifecycleTitle")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <HouseLifecycleActions
                  deactivate={rules.deactivate}
                  flags={rules.flags}
                  houseId={house.id}
                  houseNumber={house.houseNumber}
                  isActive={house.isActive}
                  reactivate={rules.reactivate}
                />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
