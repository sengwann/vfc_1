"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Landmark, Receipt, Users, Wallet } from "lucide-react";

import { Alert } from "../../../components/ui/alert";
import { buttonVariants } from "../../../components/ui/button";
import { ThemeToggle } from "../../../components/ui/theme-toggle";
import {
  TranslationProvider,
  useTranslation,
} from "../../../lib/i18n/provider";
import { LoginForm } from "./login-form";
import { LoginLanguageSwitch, useLoginLanguage } from "./login-language-switch";

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs"
    >
      <Landmark className="size-5" />
    </span>
  );
}

/* Desktop-only brand panel. Decorative copy only: it repeats what the app does. */
function BrandPanel() {
  const { t } = useTranslation();
  const points: { icon: ReactNode; text: string }[] = [
    { icon: <Wallet aria-hidden />, text: t("login.brandPointPay") },
    { icon: <Receipt aria-hidden />, text: t("login.brandPointReceipts") },
    { icon: <Users aria-hidden />, text: t("login.brandPointVillage") },
  ];

  return (
    <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground lg:flex xl:p-16">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-11 items-center justify-center rounded-xl bg-primary-foreground/15"
        >
          <Landmark className="size-6" />
        </span>
        <p className="text-lg font-semibold leading-snug">
          {t("shell.villageFundCollection")}
        </p>
      </div>

      <div className="max-w-md space-y-8">
        <p className="text-3xl font-semibold leading-snug tracking-tight text-balance">
          {t("login.brandTagline")}
        </p>
        <ul className="space-y-4">
          {points.map((point) => (
            <li className="flex items-start gap-3" key={point.text}>
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/15 [&_svg]:size-5">
                {point.icon}
              </span>
              <span className="pt-1.5 text-base leading-snug text-primary-foreground/90">
                {point.text}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div aria-hidden="true" className="h-px bg-primary-foreground/20" />
    </aside>
  );
}

function LoginContent({
  redirectTo,
  registered,
  passwordReset,
  defaultVillageCode,
}: {
  redirectTo: string;
  registered: boolean;
  passwordReset: boolean;
  defaultVillageCode: string;
}) {
  const { t, language } = useTranslation();

  return (
    <div
      className="min-h-dvh bg-background text-foreground lg:grid lg:grid-cols-[5fr_6fr]"
      lang={language === "MY" ? "my" : "en"}
    >
      <BrandPanel />

      <main className="flex min-h-dvh flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 pt-1 lg:justify-end">
          <div className="flex min-w-0 items-center gap-3 lg:hidden">
            <BrandMark />
            <p className="min-w-0 text-sm font-semibold leading-snug">
              {t("shell.villageFundCollection")}
            </p>
          </div>
          <LoginLanguageSwitch
            label={t("login.language")}
            language={language}
          />
        </div>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-8">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
              {t("login.title")}
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              {t("login.subtitle")}
            </p>
          </div>

          {registered ? (
            <Alert
              className="mt-6"
              tone="success"
              title={t("login.registeredTitle")}
            >
              {t("login.registeredBody")}
            </Alert>
          ) : null}

          {passwordReset ? (
            <Alert
              className="mt-6"
              tone="success"
              title={t("recovery.login.resetDoneTitle")}
            >
              {t("recovery.login.resetDoneBody")}
            </Alert>
          ) : null}

          <div className="mt-6 sm:rounded-2xl sm:border sm:bg-card sm:p-6 sm:shadow-sm">
            <LoginForm
              defaultVillageCode={defaultVillageCode}
              redirectTo={redirectTo}
            />
            <div className="mt-4 text-center">
              <Link
                className="text-sm text-muted-foreground underline"
                href="/forgot-password"
              >
                {t("recovery.login.forgotLink")}
              </Link>
            </div>
          </div>

          <div className="mt-8 space-y-3 border-t pt-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t("login.noAccount")}
            </p>
            <Link
              className={buttonVariants({
                variant: "outline",
                className: "w-full",
              })}
              href="/signup"
            >
              {t("login.createAccount")}
            </Link>
          </div>

          <div className="mt-6 flex justify-center">
            <ThemeToggle variant="icon" />
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Presentation shell for /login. The page (server) decides whether to show the
 * "registered" notice; the sign-in screens have no signed-in user yet, so the
 * language is a browser-only choice made with the switch in the corner.
 */
export function LoginScreen({
  redirectTo,
  registered,
  passwordReset = false,
  defaultVillageCode = "",
}: {
  redirectTo: string;
  registered: boolean;
  passwordReset?: boolean;
  defaultVillageCode?: string;
}) {
  const language = useLoginLanguage();

  return (
    <TranslationProvider language={language}>
      <LoginContent
        defaultVillageCode={defaultVillageCode}
        passwordReset={passwordReset}
        redirectTo={redirectTo}
        registered={registered}
      />
    </TranslationProvider>
  );
}
