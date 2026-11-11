"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { FormEvent, ReactNode } from "react";
import { Building2, KeyRound, Landmark, User } from "lucide-react";

import { Alert } from "../../../components/ui/alert";
import { Badge } from "../../../components/ui/badge";
import { Button, buttonVariants } from "../../../components/ui/button";
import { AlertTriangleIcon } from "../../../components/ui/icons";
import { Field, Input, Select } from "../../../components/ui/field";
import { useTranslation } from "../../../lib/i18n/provider";
import {
  registerVillagerAction,
  type RegisterVillagerActionResult,
} from "../actions/register-villager.action";
import { PasswordField } from "./password-field";
import { translateServerMessage } from "./registration-messages";

/*
 * Phones: a single column. The village is a summary card; the three sections
 * are separated by a rule. From `sm` up each section becomes a card.
 */
function FormSection({
  icon,
  title,
  description,
  children,
  id,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  children: ReactNode;
  id: string;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="space-y-4 border-t pt-6 sm:rounded-2xl sm:border sm:bg-card sm:p-6 sm:shadow-xs"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground [&_svg]:size-5"
        >
          {icon}
        </span>
        <div className="min-w-0 space-y-0.5 pt-0.5">
          <h2
            className="text-base font-semibold leading-snug"
            id={`${id}-heading`}
          >
            {title}
          </h2>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

export function RegisterVillagerForm({
  villageCode,
  villageName,
  houses,
}: {
  villageCode: string;
  villageName: string;
  houses: {
    houseNumber: string;
  }[];
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const signInGroupId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [attempt, setAttempt] = useState(0);
  const [isPending, startTransition] = useTransition();

  // After a failed submit, move keyboard and screen-reader focus to the first
  // thing that needs attention (a field, the sign-in group, or the message).
  useEffect(() => {
    if (attempt === 0) {
      return;
    }
    const target =
      formRef.current?.querySelector<HTMLElement>(
        '[aria-invalid="true"], [data-error-target="true"]',
      ) ?? alertRef.current;
    target?.focus();
  }, [attempt]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      let result: RegisterVillagerActionResult;
      try {
        result = await registerVillagerAction(formData);
      } catch {
        setFormError(t("common.error"));
        setAttempt((value) => value + 1);
        return;
      }

      if (result.success) {
        router.push(result.redirectTo);
        router.refresh();
        return;
      }

      setFieldErrors(result.fieldErrors ?? {});
      setFormError(result.formError ?? "Unable to register.");
      setAttempt((value) => value + 1);
    });
  }

  const hasFieldErrors = Object.values(fieldErrors).some(Boolean);
  const fieldError = (key: string) =>
    translateServerMessage(t, fieldErrors[key]);
  const identifierError = fieldError("identifier");
  const identifierErrorId = `${signInGroupId}-error`;
  // A field error already explains itself; the top message is only needed for
  // problems that belong to no field, or as a short pointer to the fields.
  const alertBody = hasFieldErrors
    ? t("signup.fixFields")
    : translateServerMessage(t, formError ?? undefined);
  const showAlert = hasFieldErrors || Boolean(formError);

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={handleSubmit}
      ref={formRef}
    >
      <input name="villageCode" type="hidden" value={villageCode} />

      {showAlert ? (
        <div className="outline-offset-4" ref={alertRef} tabIndex={-1}>
          <Alert tone="danger" title={t("signup.errorTitle")}>
            {alertBody}
          </Alert>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-accent/60 p-3 sm:p-4">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
        >
          <Landmark className="size-5" />
        </span>
        <div className="min-w-0 flex-1 basis-40 space-y-1">
          <p className="text-xs text-muted-foreground">{t("signup.village")}</p>
          <p className="text-base font-semibold leading-snug">{villageName}</p>
          <Badge className="font-mono" variant="neutral">
            {t("signup.codeLabel")}: {villageCode}
          </Badge>
        </div>
        <Link
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href="/signup"
        >
          {t("signup.changeVillage")}
        </Link>
      </div>

      <FormSection
        icon={<User aria-hidden />}
        id="about"
        title={t("signup.sectionAbout")}
      >
        <Field
          error={fieldError("name")}
          id="name"
          label={t("signup.name")}
          required
        >
          <Input autoComplete="name" name="name" required type="text" />
        </Field>

        <Field
          error={fieldError("dateOfBirth")}
          hint={t("signup.dobHint")}
          id="dateOfBirth"
          label={
            <>
              {t("signup.dob")}{" "}
              <span className="font-normal text-muted-foreground">
                ({t("signup.optional")})
              </span>
            </>
          }
        >
          <Input
            max={new Date().toISOString().split("T")[0]}
            name="dateOfBirth"
            type="date"
          />
        </Field>
      </FormSection>

      <FormSection
        description={t("signup.signInIntro")}
        icon={<KeyRound aria-hidden />}
        id="signin"
        title={t("signup.sectionSignIn")}
      >
        <div
          aria-describedby={identifierError ? identifierErrorId : undefined}
          aria-labelledby="signin-heading"
          className="space-y-4"
          role="group"
        >
          <Field
            error={fieldError("email")}
            id="email"
            label={t("signup.email")}
          >
            <Input
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect="off"
              inputMode="email"
              name="email"
              spellCheck={false}
              type="email"
            />
          </Field>

          <Field
            error={fieldError("phone")}
            id="phone"
            label={t("signup.phone")}
          >
            <Input
              autoComplete="tel"
              inputMode="tel"
              name="phone"
              placeholder={t("signup.phonePlaceholder")}
              type="tel"
            />
          </Field>

          {identifierError ? (
            <p
              className="flex items-start gap-1.5 text-sm font-medium text-danger-strong outline-offset-4"
              data-error-target="true"
              id={identifierErrorId}
              tabIndex={-1}
            >
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
              <span>{identifierError}</span>
            </p>
          ) : null}
        </div>

        <PasswordField
          error={fieldError("password")}
          hint={t("password.hint")}
          id="password"
          label={t("signup.password")}
          name="password"
          required
        />
      </FormSection>

      <FormSection
        description={t("signup.houseHint")}
        icon={<Building2 aria-hidden />}
        id="house"
        title={t("signup.sectionHouse")}
      >
        <Field
          error={fieldError("houseNumber")}
          id="houseNumber"
          label={t("signup.houseNumber")}
          required
        >
          <Select defaultValue="" name="houseNumber" required>
            <option disabled value="">
              {t("signup.housePlaceholder")}
            </option>
            {houses.map((house) => (
              <option key={house.houseNumber} value={house.houseNumber}>
                {house.houseNumber}
              </option>
            ))}
          </Select>
        </Field>

        <Alert tone="info">{t("signup.houseNote")}</Alert>
      </FormSection>

      <Button className="w-full" loading={isPending} size="lg" type="submit">
        {isPending ? t("signup.submitting") : t("signup.submit")}
      </Button>
    </form>
  );
}
