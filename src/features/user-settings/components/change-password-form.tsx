"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { useTranslation } from "@/lib/i18n/provider";
import {
  changePasswordAction,
  type ChangePasswordActionResult,
} from "../actions/change-password.action";
import { useFocusFirstError } from "./use-focus-first-error";

export function ChangePasswordForm() {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [isPending, startTransition] = useTransition();

  useFocusFirstError(formRef, fieldErrors, formError);

  // The server action ends the session after a successful change, so the form
  // is replaced by a confirmation. Move focus there so it is announced and in view.
  useEffect(() => {
    if (done) successRef.current?.focus();
  }, [done]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result: ChangePasswordActionResult =
        await changePasswordAction(formData);
      if (result.success) {
        setDone(true);
        return;
      }
      setFieldErrors(result.fieldErrors ?? {});
      setFormError(result.formError ?? "Unable to change password.");
    });
  }

  if (done) {
    return (
      <div className="space-y-4 outline-none" ref={successRef} tabIndex={-1}>
        <Alert tone="success" title={t("password.success")}>
          {t("password.signedOut")}
        </Alert>
        <Link
          className={buttonVariants({ className: "w-full sm:w-auto" })}
          href="/login"
        >
          {t("password.signInAgain")}
        </Link>
      </div>
    );
  }

  const passwordType = showPasswords ? "text" : "password";

  return (
    <form
      className="space-y-6"
      noValidate
      onSubmit={handleSubmit}
      ref={formRef}
    >
      <Field
        error={fieldErrors.currentPassword}
        id="currentPassword"
        label={t("password.current")}
        required
      >
        <Input
          autoComplete="current-password"
          name="currentPassword"
          required
          type={passwordType}
        />
      </Field>

      <Field
        error={fieldErrors.newPassword}
        hint={t("password.hint")}
        id="newPassword"
        label={t("password.new")}
        required
      >
        <Input
          autoComplete="new-password"
          name="newPassword"
          required
          type={passwordType}
        />
      </Field>

      <Field
        error={fieldErrors.confirmPassword}
        id="confirmPassword"
        label={t("password.confirm")}
        required
      >
        <Input
          autoComplete="new-password"
          name="confirmPassword"
          required
          type={passwordType}
        />
      </Field>

      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
        <input
          checked={showPasswords}
          className="size-5 shrink-0 accent-primary"
          onChange={(event) => setShowPasswords(event.target.checked)}
          type="checkbox"
        />
        {t("password.showPasswords")}
      </label>

      {formError ? (
        <div className="outline-none" data-form-error tabIndex={-1}>
          <Alert tone="danger">{formError}</Alert>
        </div>
      ) : null}

      <div className="flex sm:justify-end">
        <Button className="w-full sm:w-auto" loading={isPending} type="submit">
          {isPending ? t("password.changing") : t("password.change")}
        </Button>
      </div>
    </form>
  );
}
