"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Check, Landmark, Receipt, Users, Wallet } from "lucide-react";

import { buttonVariants } from "../../../components/ui/button";
import { ThemeToggle } from "../../../components/ui/theme-toggle";
import { useTranslation } from "../../../lib/i18n/provider";
import { cn } from "../../../lib/utils";
import { LoginLanguageSwitch } from "../../auth/components/login-language-switch";

const TOTAL_STEPS = 2;

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

/* Desktop-only brand panel, the same family as the sign-in screen. */
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

/* "Step 1 of 2" with two bars. Text and a check mark carry the state too. */
function StepIndicator({ current }: { current: 1 | 2 }) {
  const { t } = useTranslation();
  const steps = [t("signup.stepVillage"), t("signup.stepDetails")];
  const summary = t("signup.stepOf")
    .replace("{current}", String(current))
    .replace("{total}", String(TOTAL_STEPS));

  return (
    <nav aria-label={t("signup.stepsLabel")} className="space-y-3">
      <p className="text-sm font-medium text-muted-foreground">{summary}</p>
      <ol className="grid grid-cols-2 gap-3">
        {steps.map((label, index) => {
          const number = index + 1;
          const done = number < current;
          const active = number === current;
          return (
            <li
              aria-current={active ? "step" : undefined}
              className="space-y-1.5"
              key={number}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "block h-1.5 rounded-full",
                  done || active ? "bg-primary" : "bg-border-strong",
                )}
              />
              <span
                className={cn(
                  "flex items-center gap-1.5 text-xs leading-snug",
                  active
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {done ? (
                  <Check aria-hidden className="size-4 shrink-0 text-success" />
                ) : null}
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Page frame for the signup routes: brand panel (desktop), brand + language
 * switch (phones), optional step indicator, heading, content and a sign-in
 * link. Must be rendered inside a TranslationProvider.
 */
export function RegistrationShell({
  step,
  title,
  description,
  size = "md",
  children,
}: {
  /** Omit on pages that are not part of the two steps. */
  step?: 1 | 2;
  title: string;
  description?: string;
  size?: "md" | "lg";
  children: ReactNode;
}) {
  const { t, language } = useTranslation();

  return (
    <div
      className="min-h-dvh bg-background text-foreground lg:grid lg:grid-cols-[5fr_6fr]"
      lang={language === "MY" ? "my" : "en"}
    >
      <BrandPanel />

      <main className="flex min-h-dvh flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
        <div
          className={cn(
            "mx-auto flex w-full items-center justify-between gap-3 pt-1 lg:justify-end",
            size === "lg" ? "max-w-lg" : "max-w-md",
          )}
        >
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

        <div
          className={cn(
            "mx-auto flex w-full flex-1 flex-col justify-center py-8",
            size === "lg" ? "max-w-lg" : "max-w-md",
          )}
        >
          {step ? <StepIndicator current={step} /> : null}

          <div className={cn("space-y-2", step ? "mt-6" : "")}>
            <h1 className="text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="text-sm text-muted-foreground sm:text-base">
                {description}
              </p>
            ) : null}
          </div>

          <div className="mt-6">{children}</div>

          <div className="mt-8 space-y-3 border-t pt-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t("signup.haveAccount")}
            </p>
            <Link
              className={buttonVariants({
                variant: "outline",
                className: "w-full",
              })}
              href="/login"
            >
              {t("signup.signIn")}
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
