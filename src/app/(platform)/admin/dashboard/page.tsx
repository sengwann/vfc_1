import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { VillageStatus } from "@prisma/client";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { VillageStatusBadge } from "@/features/village-management/components/village-status-badge";
import { VillageStatusSummary } from "@/features/village-management/components/village-status-summary";
import { getPlatformShellContext } from "@/features/shell/lib/shell-context";
import { formatYangonDateTime } from "@/lib/utils";
import { getT } from "@/lib/i18n/translations";
import { prisma } from "@/lib/prisma";

export const metadata = {
  title: "Platform Dashboard | Village Fund Collection System",
};

function fill(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

export default async function AdminDashboardPage() {
  const { language } = await getPlatformShellContext();
  const t = getT(language);

  const [
    totalVillages,
    activeVillages,
    suspendedVillages,
    deactivatedVillages,
    recentVillages,
  ] = await Promise.all([
    prisma.village.count(),
    prisma.village.count({ where: { status: VillageStatus.ACTIVE } }),
    prisma.village.count({ where: { status: VillageStatus.SUSPENDED } }),
    prisma.village.count({ where: { status: VillageStatus.DEACTIVATED } }),
    prisma.village.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        villageCode: true,
        name: true,
        status: true,
        createdAt: true,
      },
    }),
  ]);

  const statusLabels: Record<VillageStatus, string> = {
    [VillageStatus.ACTIVE]: t("adminDashboard.status.active"),
    [VillageStatus.SUSPENDED]: t("adminDashboard.status.suspended"),
    [VillageStatus.DEACTIVATED]: t("adminDashboard.status.deactivated"),
  };

  const createHref = "/admin/villages/new";

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <Button asChild>
            <Link href={createHref}>
              <Plus aria-hidden />
              {t("adminDashboard.create")}
            </Link>
          </Button>
        }
        description={t("adminDashboard.description")}
        title={t("adminDashboard.title")}
      />

      {suspendedVillages > 0 ? (
        <Alert
          action={
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/villages">{t("adminDashboard.review")}</Link>
            </Button>
          }
          title={fill(
            t(
              suspendedVillages === 1
                ? "adminDashboard.suspendedOne"
                : "adminDashboard.suspendedOther",
            ),
            { count: suspendedVillages },
          )}
          tone="warning"
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <VillageStatusSummary
          chartLabel={fill(t("adminDashboard.chartLabel"), {
            total: totalVillages,
            active: activeVillages,
            suspended: suspendedVillages,
            deactivated: deactivatedVillages,
          })}
          counts={{
            [VillageStatus.ACTIVE]: activeVillages,
            [VillageStatus.SUSPENDED]: suspendedVillages,
            [VillageStatus.DEACTIVATED]: deactivatedVillages,
          }}
          statusLabels={statusLabels}
          title={t("adminDashboard.statusTitle")}
          total={totalVillages}
          totalLabel={t("adminDashboard.totalVillages")}
        />

        <Section
          actions={
            recentVillages.length > 0 ? (
              <Link
                className={buttonVariants({ variant: "ghost", size: "sm" })}
                href="/admin/villages"
              >
                {t("adminDashboard.viewAll")}
                <ChevronRight aria-hidden className="rtl:rotate-180" />
              </Link>
            ) : null
          }
          className="lg:col-span-2"
          title={t("adminDashboard.recent")}
        >
          {recentVillages.length === 0 ? (
            <EmptyState
              action={
                <Button asChild>
                  <Link href={createHref}>
                    <Plus aria-hidden />
                    {t("adminDashboard.create")}
                  </Link>
                </Button>
              }
              description={t("adminDashboard.emptyBody")}
              title={t("adminDashboard.emptyTitle")}
            />
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y">
                {recentVillages.map((village) => (
                  <li key={village.id}>
                    <Link
                      className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted sm:px-5"
                      href={`/admin/villages/${village.id}`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                          <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                            {village.villageCode}
                          </p>
                          <VillageStatusBadge
                            label={statusLabels[village.status]}
                            status={village.status}
                          />
                        </div>
                        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                          {village.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <time dateTime={village.createdAt.toISOString()}>
                            {fill(t("adminDashboard.created"), {
                              date: formatYangonDateTime(
                                village.createdAt,
                                "date",
                              ),
                            })}
                          </time>
                        </p>
                      </div>
                      <ChevronRight
                        aria-hidden
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </Section>
      </div>
    </div>
  );
}