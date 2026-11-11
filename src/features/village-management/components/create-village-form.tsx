"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import type { TranslationKey } from "@/lib/i18n/en";
import { useTranslation } from "@/lib/i18n/provider";
import {
  createVillageAction,
  type CreateVillageActionResult,
} from "../actions/create-village.action";
import type {
  CreateVillageFieldErrorCode,
  CreateVillageFormErrorCode,
} from "../lib/village-validation-rules";

/*
 * The action returns error CODES, not text. They are mapped to translation
 * keys here (presentation only). Typing the maps as Records means a new code
 * cannot be added to the action without adding its message here.
 */
const FIELD_ERROR_KEYS: Record<CreateVillageFieldErrorCode, TranslationKey> = {
  CODE_INVALID: "adminVillages.err.codeInvalid",
  CODE_EXISTS: "adminVillages.err.codeExists",
  NAME_LENGTH: "adminVillages.err.nameLength",
  CHIEF_NAME_LENGTH: "adminVillages.err.chiefNameLength",
  EMAIL_INVALID: "adminVillages.err.emailInvalid",
  EMAIL_EXISTS: "adminVillages.err.emailExists",
  PHONE_INVALID: "adminVillages.err.phoneInvalid",
  PHONE_EXISTS: "adminVillages.err.phoneExists",
  IDENTIFIER_REQUIRED: "adminVillages.err.identifierRequired",
  PASSWORD_LENGTH: "adminVillages.err.passwordLength",
  PASSWORD_TOO_LONG: "adminVillages.err.passwordBytes",
};

const FORM_ERROR_KEYS: Record<CreateVillageFormErrorCode, TranslationKey> = {
  EXISTS: "adminVillages.err.exists",
  RETRY: "adminVillages.err.retry",
  GENERIC: "adminVillages.form.generic",
};

export function CreateVillageForm() {
  const router = useRouter();
  const { t } = useTranslation();

  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [failureCount, setFailureCount] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, startTransition] = useTransition();
  const errorRef = useRef<HTMLDivElement>(null);

  // Move focus to the error summary after each failed submit.
  useEffect(() => {
    if (failureCount > 0) {
      errorRef.current?.focus();
    }
  }, [failureCount]);

  // A code this build does not know (for example during a deploy) falls back
  // to the generic message instead of rendering nothing.
  function translateFieldError(code: CreateVillageFieldErrorCode): string {
    const key = FIELD_ERROR_KEYS[code];
    return key ? t(key) : t("adminVillages.form.generic");
  }

  function translateFormError(code: CreateVillageFormErrorCode): string {
    const key = FORM_ERROR_KEYS[code];
    return key ? t(key) : t("adminVillages.form.generic");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setFormError(null);
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result: CreateVillageActionResult =
        await createVillageAction(formData);

      if (result.success) {
        router.push(`/admin/villages/${result.villageId}`);
        router.refresh();
        return;
      }

      const translated: Record<string, string | undefined> = {};
      for (const [field, code] of Object.entries(result.fieldErrors ?? {})) {
        translated[field] = code ? translateFieldError(code) : undefined;
      }

      const hasFieldErrors = Object.values(translated).some(Boolean);

      setFieldErrors(translated);
      setFormError(
        result.formError
          ? translateFormError(result.formError)
          : hasFieldErrors
            ? t("adminVillages.form.fixFields")
            : t("adminVillages.form.generic"),
      );
      setFailureCount((count) => count + 1);
    });
  }

  return (
    <form className="space-y-6" noValidate onSubmit={handleSubmit}>
      {formError ? (
        <div className="outline-none" ref={errorRef} tabIndex={-1}>
          <Alert title={t("adminVillages.form.errorTitle")} tone="danger">
            {formError}
          </Alert>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <Card>
          <CardHeader>
            <CardTitle as="h2">
              {t("adminVillages.form.villageTitle")}
            </CardTitle>
            <CardDescription>
              {t("adminVillages.form.villageDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field
              error={fieldErrors.villageCode}
              hint={t("adminVillages.form.codeHint")}
              id="villageCode"
              label={t("adminVillages.form.code")}
              required
            >
              <Input
                autoComplete="off"
                name="villageCode"
                placeholder={t("adminVillages.form.codePlaceholder")}
                required
                spellCheck={false}
              />
            </Field>

            <Field
              error={fieldErrors.villageName}
              id="villageName"
              label={t("adminVillages.form.name")}
              required
            >
              <Input
                autoComplete="off"
                name="villageName"
                placeholder={t("adminVillages.form.namePlaceholder")}
                required
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t("adminVillages.form.chiefTitle")}</CardTitle>
            <CardDescription>
              {t("adminVillages.form.chiefDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field
              error={fieldErrors.chiefName}
              id="chiefName"
              label={t("adminVillages.form.chiefName")}
              required
            >
              <Input autoComplete="off" name="chiefName" required />
            </Field>

            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("adminVillages.form.contactHint")}
              </p>

              {fieldErrors.chiefIdentifier ? (
                <Alert tone="danger">{fieldErrors.chiefIdentifier}</Alert>
              ) : null}

              <Field
                error={fieldErrors.chiefEmail}
                id="chiefEmail"
                label={t("adminVillages.form.chiefEmail")}
              >
                <Input
                  autoComplete="off"
                  inputMode="email"
                  name="chiefEmail"
                  type="email"
                />
              </Field>

              <Field
                error={fieldErrors.chiefPhone}
                id="chiefPhone"
                label={t("adminVillages.form.chiefPhone")}
              >
                <Input
                  autoComplete="off"
                  inputMode="tel"
                  name="chiefPhone"
                  placeholder={t("adminVillages.form.phonePlaceholder")}
                  type="tel"
                />
              </Field>
            </div>

            <div className="space-y-1">
              <Field
                error={fieldErrors.chiefPassword}
                hint={t("adminVillages.form.passwordHint")}
                id="chiefPassword"
                label={t("adminVillages.form.password")}
                required
              >
                <Input
                  autoComplete="new-password"
                  name="chiefPassword"
                  required
                  type={showPassword ? "text" : "password"}
                />
              </Field>

              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  checked={showPassword}
                  className="size-5 shrink-0 accent-primary"
                  onChange={(event) => setShowPassword(event.target.checked)}
                  type="checkbox"
                />
                {t("login.showPassword")}
              </label>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Link
          className={buttonVariants({
            variant: "outline",
            size: "lg",
            className: "sm:min-w-32",
          })}
          href="/admin/villages"
        >
          {t("common.cancel")}
        </Link>
        <Button
          className="sm:min-w-48"
          loading={isPending}
          size="lg"
          type="submit"
        >
          {isPending
            ? t("adminVillages.form.submitting")
            : t("adminVillages.form.submit")}
        </Button>
      </div>
    </form>
  );
}
