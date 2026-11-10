import { LanguagePreference, MembershipStatus } from "@prisma/client";
import { LogOut } from "lucide-react";
import { logoutAction } from "../../../features/auth/actions/logout.action";
import { RejoinForm } from "../../../features/membership-rejoin/components/rejoin-form";
import { requireRejoinContext } from "../../../features/membership-rejoin/lib/rejoin-access";
import { BrandMark } from "../../../features/shell/components/brand-mark";
import {
  getInitials,
  getMembershipLabel,
  getMembershipTone,
} from "../../../features/shell/lib/shell-labels";
import { Alert } from "../../../components/ui/alert";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { EmptyState } from "../../../components/ui/empty-state";
import { PageHeader } from "../../../components/ui/page-header";
import { getT } from "../../../lib/i18n/translations";
import { prisma } from "../../../lib/prisma";

export const metadata = {
  title: "Rejoin Household | Village Fund Collection System",
};

export default async function RejoinPage() {
  const { user, villageId, membershipStatus } = await requireRejoinContext();

  const village = await prisma.village.findUnique({
    where: {
      id: villageId,
    },
    select: {
      name: true,
      villageCode: true,
    },
  });

  const houses = await prisma.house.findMany({
    where: {
      villageId,
      isActive: true,
    },
    orderBy: {
      houseNumber: "asc",
    },
    select: {
      houseNumber: true,
    },
  });

  // Presentation only: this route sits outside the app shell, so it reads the
  // same language setting the shell uses to pick the page language.
  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id },
    select: { language: true },
  });
  const language = settings?.language ?? LanguagePreference.EN;
  const t = getT(language);

  const villageName = village?.name ?? t("rejoin.villageFallback");
  const statusTitle =
    membershipStatus === MembershipStatus.REMOVED
      ? t("rejoin.statusRemovedTitle")
      : t("rejoin.statusRejectedTitle");

  return (
    <main
      className="min-h-dvh bg-background text-foreground"
      lang={language === LanguagePreference.MY ? "my" : "en"}
    >
      <div className="mx-auto w-full max-w-lg space-y-5 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:space-y-6 sm:px-6 sm:pt-10">
        <div className="flex items-center gap-3">
          <BrandMark variant="village" />
          <p className="min-w-0 text-sm font-semibold leading-snug">
            {t("shell.villageFundCollection")}
          </p>
        </div>

        <PageHeader
          description={t("rejoin.subtitle").replace("{village}", villageName)}
          title={t("rejoin.title")}
        />

        <Alert
          tone={
            membershipStatus === MembershipStatus.REMOVED ? "warning" : "danger"
          }
          title={statusTitle}
        >
          {t("rejoin.statusBody").replace("{village}", villageName)}
        </Alert>

        <dl className="divide-y rounded-xl border bg-card text-sm shadow-xs">
          <div className="flex items-start justify-between gap-4 px-4 py-3">
            <dt className="shrink-0 text-muted-foreground">
              {t("rejoin.village")}
            </dt>
            <dd className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">
              {villageName}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4 px-4 py-3">
            <dt className="shrink-0 text-muted-foreground">
              {t("rejoin.membership")}
            </dt>
            <dd className="min-w-0 text-right">
              <Badge dot variant={getMembershipTone(membershipStatus)}>
                {getMembershipLabel(t, membershipStatus)}
              </Badge>
            </dd>
          </div>
        </dl>

        {houses.length === 0 ? (
          <EmptyState
            description={t("rejoin.noHousesBody")}
            title={t("rejoin.noHousesTitle")}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle as="h2">{t("rejoin.formTitle")}</CardTitle>
              <CardDescription>{t("rejoin.formDesc")}</CardDescription>
            </CardHeader>
            <CardContent>
              <RejoinForm houses={houses} />
            </CardContent>
          </Card>
        )}

        <div className="space-y-3 border-t pt-5">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-accent-foreground"
            >
              {getInitials(user.name)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                {t("rejoin.signedInAs")}
              </p>
              <p className="text-sm font-semibold leading-snug [overflow-wrap:anywhere]">
                {user.name}
              </p>
            </div>
          </div>
          <form action={logoutAction}>
            <Button className="w-full" type="submit" variant="outline">
              <LogOut aria-hidden />
              {t("nav.logout")}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
