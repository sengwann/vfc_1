import type { ReactNode } from "react";
import { LanguagePreference } from "@prisma/client";
import { Home, LogOut, Lock, Settings, UserCircle } from "lucide-react";
import { ChangePasswordForm } from "@/features/user-settings/components/change-password-form";
import { EditProfileForm } from "@/features/user-settings/components/edit-profile-form";
import { AppearanceSetting } from "@/features/user-settings/components/appearance-setting";
import { SettingsSection } from "@/features/user-settings/components/settings-section";
import { UpdateSettingsForm } from "@/features/user-settings/components/update-settings-form";
import {
  getInitials,
  getMembershipLabel,
  getMembershipTone,
  getRoleLabel,
} from "@/features/shell/lib/shell-labels";
import { logoutAction } from "@/features/auth/actions/logout.action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthenticatedUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { getT } from "@/lib/i18n/translations";

export const metadata = {
  title: "Settings | Village Fund Collection System",
};

export default async function SettingsPage() {
  const user = await requireAuthenticatedUser();

  const village = user.villageId
    ? await prisma.village.findUnique({
        where: { id: user.villageId },
        select: { name: true },
      })
    : null;

  const house = user.houseId
    ? await prisma.house.findUnique({
        where: { id: user.houseId },
        select: { houseNumber: true },
      })
    : null;

  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id },
    select: { language: true },
  });

  const language = settings?.language ?? LanguagePreference.EN;
  const t = getT(language);

  const accountRows: { label: string; value: ReactNode }[] = [
    { label: t("settings.village"), value: village?.name ?? "—" },
    { label: t("settings.house"), value: house?.houseNumber ?? "—" },
    {
      label: t("settings.membership"),
      value: user.membershipStatus ? (
        <Badge dot variant={getMembershipTone(user.membershipStatus)}>
          {getMembershipLabel(t, user.membershipStatus)}
        </Badge>
      ) : (
        "—"
      ),
    },
  ];

  /*
   * This route sits outside the app shell, so it sets its own `lang` (the
   * root <html> is fixed to "en") to get correct Myanmar text shaping.
   */
  return (
    <main
      className="min-h-dvh bg-background text-foreground"
      lang={language === LanguagePreference.MY ? "my" : "en"}
    >
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:pt-8">
        <PageHeader
          actions={
            <form action={logoutAction}>
              <Button className="w-full" type="submit" variant="outline">
                <LogOut aria-hidden />
                {t("nav.logout")}
              </Button>
            </form>
          }
          backHref="/dashboard"
          backLabel={t("settings.backToDashboard")}
          description={t("settings.subtitle")}
          title={t("settings.title")}
        />

        <div className="space-y-4 sm:space-y-6">
          {/* Account (read-only) */}
          <SettingsSection
            icon={Home}
            id="settings-account"
            title={t("settings.accountInfo")}
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-base font-semibold text-accent-foreground"
              >
                {getInitials(user.name)}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-semibold leading-snug [overflow-wrap:anywhere]">
                  {user.name}
                </p>
                <Badge variant="neutral">{getRoleLabel(t, user.role)}</Badge>
              </div>
            </div>

            <dl className="mt-4 divide-y rounded-lg border">
              {accountRows.map((row) => (
                <div
                  className="flex items-start justify-between gap-4 px-3 py-3 text-sm"
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

            <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
              <InfoIcon className="mt-0.5 size-4 shrink-0" />
              <span>{t("settings.accountNote")}</span>
            </p>
          </SettingsSection>

          {/* Preferences */}
          <SettingsSection
            description={t("settings.preferencesDesc")}
            icon={Settings}
            id="settings-preferences"
            title={t("settings.preferences")}
          >
            <div className="space-y-6">
              <AppearanceSetting />
              <div className="border-t pt-6">
                <UpdateSettingsForm initialLanguage={language} />
              </div>
            </div>
          </SettingsSection>

          {/* Edit Profile */}
          <SettingsSection
            description={t("settings.profileDesc")}
            icon={UserCircle}
            id="settings-profile"
            title={t("settings.editProfile")}
          >
            <EditProfileForm
              initialDateOfBirth={
                user.dateOfBirth
                  ? user.dateOfBirth.toISOString().split("T")[0]
                  : ""
              }
              initialEmail={user.email ?? ""}
              initialName={user.name}
              initialPhone={user.phone ?? ""}
            />
          </SettingsSection>

          {/* Change Password */}
          <SettingsSection
            description={t("settings.passwordDesc")}
            icon={Lock}
            id="settings-password"
            title={t("settings.changePassword")}
          >
            <ChangePasswordForm />
          </SettingsSection>
        </div>
      </div>
    </main>
  );
}
