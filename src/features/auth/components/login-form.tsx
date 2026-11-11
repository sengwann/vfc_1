"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";

import { Alert } from "../../../components/ui/alert";
import { Button } from "../../../components/ui/button";
import {
  Field,
  Input,
  fieldControlClasses,
} from "../../../components/ui/field";
import { useTranslation } from "../../../lib/i18n/provider";
import { cn } from "../../../lib/utils";
import { loginAction } from "../actions/login.action";

export function LoginForm({
  redirectTo,
  defaultVillageCode,
}: {
  redirectTo?: string;
  /** Pre-filled from the registration redirect; empty for administrators. */
  defaultVillageCode?: string;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const passwordId = useId();

  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError(null);

    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      let result: Awaited<ReturnType<typeof loginAction>>;
      try {
        result = await loginAction(formData);
      } catch {
        setError(t("common.error"));
        return;
      }

      if (!result.success) {
        if (result.code === "THROTTLED") {
          const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
          setError(
            t("login.errorThrottled").replace("{minutes}", String(minutes)),
          );
        } else {
          setError(t("login.errorInvalid"));
        }
        return;
      }

      router.push(result.redirectTo);
      router.refresh();
    });
  }

  return (
    <form className="space-y-5" method="post" onSubmit={handleSubmit}>
      {error ? (
        <Alert tone="danger" title={t("login.errorTitle")}>
          {error}
        </Alert>
      ) : null}

      {redirectTo ? (
        <input name="redirectTo" type="hidden" value={redirectTo} />
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
          defaultValue={defaultVillageCode}
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

      <div className="space-y-1.5">
        <label
          className="block text-sm font-medium text-foreground"
          htmlFor={passwordId}
        >
          {t("login.password")}
          <span aria-hidden="true" className="ms-0.5 text-danger-strong">
            *
          </span>
        </label>
        <div className="relative">
          <input
            autoCapitalize="none"
            autoComplete="current-password"
            autoCorrect="off"
            className={cn(fieldControlClasses, "pe-12")}
            id={passwordId}
            name="password"
            required
            spellCheck={false}
            type={showPassword ? "text" : "password"}
          />
          <button
            aria-label={
              showPassword ? t("login.hidePassword") : t("login.showPassword")
            }
            aria-pressed={showPassword}
            className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-lg text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowPassword((value) => !value)}
            type="button"
          >
            {showPassword ? (
              <EyeOff aria-hidden className="size-5" />
            ) : (
              <Eye aria-hidden className="size-5" />
            )}
          </button>
        </div>
      </div>

      <Button className="w-full" loading={isPending} size="lg" type="submit">
        {isPending ? t("login.submitting") : t("login.submit")}
      </Button>
    </form>
  );
}
