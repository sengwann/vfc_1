"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import { Field, Input } from "../../../components/ui/field";
import type { TranslationKey } from "../../../lib/i18n/en";
import { useTranslation } from "../../../lib/i18n/provider";
import { redeemRecoveryCodeAction } from "../actions/redeem-recovery-code.action";
import { FORGOT_PASSWORD_PATH } from "../lib/recovery-paths";
import type { RedeemErrorCode, RedeemFormState } from "../lib/recovery-results";

const INITIAL: RedeemFormState = { status: "idle" };

const ERROR_KEYS: Record<RedeemErrorCode, TranslationKey> = {
  invalid_input: "recovery.reset.err.invalid_input",
  password_mismatch: "recovery.reset.err.password_mismatch",
  password_length: "recovery.reset.err.password_length",
  password_bytes: "recovery.reset.err.password_bytes",
  invalid_code: "recovery.reset.err.invalid_code",
  throttled: "recovery.reset.err.throttled",
  busy: "recovery.reset.err.busy",
};

export function ResetPasswordForm() {
  const { t } = useTranslation();
  const [state, formAction, pending] = useActionState(
    redeemRecoveryCodeAction,
    INITIAL,
  );

  return (
    <form action={formAction} className="space-y-5">
      {state.status === "error" ? (
        <Alert tone="danger" title={t("recovery.reset.errorTitle")}>
          {t(ERROR_KEYS[state.error])}
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

      <Field
        hint={t("recovery.reset.codeHint")}
        id="code"
        label={t("recovery.reset.codeLabel")}
        required
      >
        <Input
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          className="font-mono uppercase tracking-widest"
          maxLength={64}
          name="code"
          required
          spellCheck={false}
          type="text"
        />
      </Field>

      <Field
        hint={t("recovery.reset.passwordHint")}
        id="newPassword"
        label={t("recovery.reset.newPassword")}
        required
      >
        <Input
          autoComplete="new-password"
          name="newPassword"
          required
          type="password"
        />
      </Field>

      <Field
        id="confirmPassword"
        label={t("recovery.reset.confirmPassword")}
        required
      >
        <Input
          autoComplete="new-password"
          name="confirmPassword"
          required
          type="password"
        />
      </Field>

      <Button className="w-full" loading={pending} size="lg" type="submit">
        {pending ? t("recovery.reset.submitting") : t("recovery.reset.submit")}
      </Button>

      <div className="flex flex-col items-center gap-2 text-sm">
        <Link
          className="text-muted-foreground underline"
          href={FORGOT_PASSWORD_PATH}
        >
          {t("recovery.reset.needCode")}
        </Link>
        <Link className="text-muted-foreground underline" href="/login">
          {t("recovery.forgot.backToLogin")}
        </Link>
      </div>
    </form>
  );
}
