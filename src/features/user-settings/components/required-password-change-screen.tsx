"use client";

import { LogOut } from "lucide-react";
import type { LanguagePreference } from "@prisma/client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { logoutAction } from "@/features/auth/actions/logout.action";
import {
  LoginLanguageSwitch,
  useLoginLanguage,
} from "@/features/auth/components/login-language-switch";
import { BrandMark } from "@/features/shell/components/brand-mark";
import { TranslationProvider, useTranslation } from "@/lib/i18n/provider";
import { ChangePasswordForm } from "./change-password-form";

function RequiredPasswordChangeContent({
  showLanguageSwitch,
}: {
  showLanguageSwitch: boolean;
}) {
  const { t, language } = useTranslation();

  return (
    <main
      className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]"
      lang={language === "MY" ? "my" : "en"}
    >
      <Card className="w-full max-w-md">
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <BrandMark variant="village" />
              <p className="min-w-0 text-sm font-semibold leading-snug">
                {t("shell.villageFundCollection")}
              </p>
            </div>
            {showLanguageSwitch ? (
              <LoginLanguageSwitch
                label={t("login.language")}
                language={language}
              />
            ) : null}
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-semibold leading-snug tracking-tight">
              {t("passwordRequired.title")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("passwordRequired.body")}
            </p>
          </div>

          <Alert tone="info">{t("passwordRequired.hint")}</Alert>

          <ChangePasswordForm />

          <form action={logoutAction}>
            <Button className="w-full" type="submit" variant="outline">
              <LogOut aria-hidden />
              {t("nav.logout")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

/**
 * Screen for an account that must replace its initial password. A saved
 * language (set in Settings) wins; a new account has none, so the browser-only
 * sign-in language is used and the switch stays available.
 */
export function RequiredPasswordChangeScreen({
  savedLanguage,
}: {
  savedLanguage: LanguagePreference | null;
}) {
  const browserLanguage = useLoginLanguage();
  const language = savedLanguage ?? browserLanguage;

  return (
    <TranslationProvider language={language}>
      <RequiredPasswordChangeContent showLanguageSwitch={!savedLanguage} />
    </TranslationProvider>
  );
}
