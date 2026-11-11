"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Landmark } from "lucide-react";

import { ThemeToggle } from "../../../components/ui/theme-toggle";
import {
  TranslationProvider,
  useTranslation,
} from "../../../lib/i18n/provider";
import {
  LoginLanguageSwitch,
  useLoginLanguage,
} from "../../auth/components/login-language-switch";

function ShellContent({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const { t, language } = useTranslation();

  return (
    <div
      className="min-h-dvh bg-background text-foreground"
      lang={language === "MY" ? "my" : "en"}
    >
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
        <div className="flex items-center justify-between gap-3 pt-1">
          <Link className="flex min-w-0 items-center gap-3" href="/login">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs"
            >
              <Landmark className="size-5" />
            </span>
            <span className="min-w-0 text-sm font-semibold leading-snug">
              {t("shell.villageFundCollection")}
            </span>
          </Link>
          <LoginLanguageSwitch
            label={t("login.language")}
            language={language}
          />
        </div>

        <div className="flex flex-1 flex-col justify-center py-8">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
              {title}
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              {subtitle}
            </p>
          </div>

          <div className="mt-6 sm:rounded-2xl sm:border sm:bg-card sm:p-6 sm:shadow-sm">
            {children}
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
 * Frame for the two public recovery pages. Nobody is signed in, so the language
 * is the browser-only choice used by the sign-in screen. The title and subtitle
 * are passed as translation KEYS so they are translated inside the provider.
 */
export function RecoveryAuthShell({
  titleKey,
  subtitleKey,
  children,
}: {
  titleKey: "recovery.forgot.title" | "recovery.reset.title";
  subtitleKey: "recovery.forgot.subtitle" | "recovery.reset.subtitle";
  children: ReactNode;
}) {
  const language = useLoginLanguage();

  return (
    <TranslationProvider language={language}>
      <TitledShell subtitleKey={subtitleKey} titleKey={titleKey}>
        {children}
      </TitledShell>
    </TranslationProvider>
  );
}

function TitledShell({
  titleKey,
  subtitleKey,
  children,
}: {
  titleKey: "recovery.forgot.title" | "recovery.reset.title";
  subtitleKey: "recovery.forgot.subtitle" | "recovery.reset.subtitle";
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <ShellContent subtitle={t(subtitleKey)} title={t(titleKey)}>
      {children}
    </ShellContent>
  );
}
