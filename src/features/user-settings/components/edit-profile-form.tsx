"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useTranslation } from "@/lib/i18n/provider";
import {
  updateProfileAction,
  type UpdateProfileActionResult,
} from "../actions/update-profile.action";
import { InlineError } from "./inline-error";
import { useFocusFirstError } from "./use-focus-first-error";

export function EditProfileForm({
  initialName,
  initialEmail,
  initialPhone,
  initialDateOfBirth,
}: {
  initialName: string;
  initialEmail: string;
  initialPhone: string;
  initialDateOfBirth: string;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [isPending, startTransition] = useTransition();

  useFocusFirstError(formRef, fieldErrors, formError);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSaved(false);
    setFieldErrors({});
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result: UpdateProfileActionResult =
        await updateProfileAction(formData);
      if (result.success) {
        setSaved(true);
        router.refresh();
        return;
      }
      setFieldErrors(result.fieldErrors ?? {});
      setFormError(result.formError ?? "Unable to update profile.");
    });
  }

  // "Email or phone" is validated as a pair, so its error belongs to both
  // controls: mark them invalid and point them at the shared message.
  const identifierError = fieldErrors.identifier;
  const describedBy = (id: string, hasOwnError: boolean) =>
    [
      hasOwnError ? `${id}-error` : null,
      identifierError ? "identifier-error" : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <form
      className="space-y-6"
      noValidate
      onChange={() => {
        if (saved) setSaved(false);
      }}
      onSubmit={handleSubmit}
      ref={formRef}
    >
      <Field
        error={fieldErrors.name}
        id="name"
        label={t("profile.name")}
        required
      >
        <Input
          autoComplete="name"
          defaultValue={initialName}
          name="name"
          required
          type="text"
        />
      </Field>

      <fieldset className="min-w-0 space-y-4 rounded-lg border bg-muted/40 p-4">
        <legend className="px-1 text-sm font-semibold">
          {t("profile.signInGroup")}
        </legend>
        <p className="text-sm text-muted-foreground">
          {t("profile.signInIntro")}
        </p>

        <Field error={fieldErrors.email} id="email" label={t("profile.email")}>
          <Input
            aria-describedby={describedBy("email", Boolean(fieldErrors.email))}
            aria-invalid={identifierError ? true : undefined}
            autoComplete="email"
            defaultValue={initialEmail}
            inputMode="email"
            name="email"
            type="email"
          />
        </Field>

        <Field error={fieldErrors.phone} id="phone" label={t("profile.phone")}>
          <Input
            aria-describedby={describedBy("phone", Boolean(fieldErrors.phone))}
            aria-invalid={identifierError ? true : undefined}
            autoComplete="tel"
            defaultValue={initialPhone}
            inputMode="tel"
            name="phone"
            placeholder={t("settings.phonePlaceholder")}
            type="tel"
          />
        </Field>

        {identifierError ? (
          <InlineError id="identifier-error">{identifierError}</InlineError>
        ) : null}
      </fieldset>

      <Field
        error={fieldErrors.dateOfBirth}
        hint={t("profile.dobHint")}
        id="dateOfBirth"
        label={
          <>
            {t("profile.dob")}{" "}
            <span className="font-normal text-muted-foreground">
              ({t("profile.optional")})
            </span>
          </>
        }
      >
        <Input
          autoComplete="bday"
          defaultValue={initialDateOfBirth}
          max={new Date().toISOString().split("T")[0]}
          name="dateOfBirth"
          type="date"
        />
      </Field>

      {formError ? (
        <div className="outline-none" data-form-error tabIndex={-1}>
          <Alert tone="danger">{formError}</Alert>
        </div>
      ) : null}

      {saved ? <Alert tone="success">{t("profile.saved")}</Alert> : null}

      <div className="flex sm:justify-end">
        <Button className="w-full sm:w-auto" loading={isPending} type="submit">
          {isPending ? t("profile.saving") : t("profile.saveProfile")}
        </Button>
      </div>
    </form>
  );
}
