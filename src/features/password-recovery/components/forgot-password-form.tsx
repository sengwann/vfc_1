"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Alert } from "../../../components/ui/alert";
import { Button, buttonVariants } from "../../../components/ui/button";
import { Field, Input } from "../../../components/ui/field";
import { useTranslation } from "../../../lib/i18n/provider";
import { requestPasswordRecoveryAction } from "../actions/request-password-recovery.action";
import type { RequestFormState } from "../lib/recovery-results";
import { RESET_PASSWORD_PATH } from "../lib/recovery-paths";

const INITIAL: RequestFormState = { status: "idle" };

/*
 * The visitor sees the same confirmation whether or not the account exists:
 * the server action gives no other answer, and this form shows none.
 */
export function ForgotPasswordForm() {
  const { t } = useTranslation();
  const [state, formAction, pending] = useActionState(
    requestPasswordRecoveryAction,
    INITIAL,
  );

  if (state.status === "submitted") {
    return (
      <div className="space-y-5">
        <Alert tone="success" title={t("recovery.forgot.doneTitle")}>
          {t("recovery.forgot.done")}
        </Alert>
        <Link
          className={buttonVariants({ variant: "outline", className: "w-full" })}
          href={RESET_PASSWORD_PATH}
        >
          {t("recovery.forgot.haveCode")}
        </Link>
        <Link
          className="block text-center text-sm text-muted-foreground underline"
          href="/login"
        >
          {t("recovery.forgot.backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-5">
      {state.status === "invalid" ? (
        <Alert tone="danger" title={t("recovery.forgot.invalidTitle")}>
          {t("recovery.forgot.invalid")}
        </Alert>
      ) : null}

      <Field
        hint={t("login.villageCodeHint")}
        id="villageCode"
        label={t("signup.codeLabel")}
      >
        <Input
          autoCapitalize="characters"
          autoComplete="organization"
          autoCorrect="off"
          className="font-mono uppercase tracking-wider placeholder:font-sans placeholder:normal-case placeholder:tracking-normal"
          name="villageCode"
          placeholder={t("signup.codePlaceholder")}
          spellCheck={false}
          type="text"
        />
      </Field>

      <Field id="identifier" label={t("login.identifier")} required>
        <Input
          autoCapitalize="none"
          autoComplete="username"
          autoCorrect="off"
          name="identifier"
          placeholder={t("login.identifierPlaceholder")}
          required
          spellCheck={false}
          type="text"
        />
      </Field>

      <Button className="w-full" loading={pending} size="lg" type="submit">
        {pending ? t("recovery.forgot.submitting") : t("recovery.forgot.submit")}
      </Button>

      <div className="flex flex-col items-center gap-2 text-sm">
        <Link className="text-muted-foreground underline" href={RESET_PASSWORD_PATH}>
          {t("recovery.forgot.haveCode")}
        </Link>
        <Link className="text-muted-foreground underline" href="/login">
          {t("recovery.forgot.backToLogin")}
        </Link>
      </div>
    </form>
  );
}
