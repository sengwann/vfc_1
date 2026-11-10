"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { ArrowRight } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { Field, Input } from "../../../components/ui/field";
import { useTranslation } from "../../../lib/i18n/provider";
import {
  validateVillageCodeAction,
  type ValidateVillageCodeActionResult,
} from "../actions/validate-village-code.action";
import { translateServerMessage } from "./registration-messages";

export function VillageCodeForm() {
  const router = useRouter();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      let result: ValidateVillageCodeActionResult;
      try {
        result = await validateVillageCodeAction(formData);
      } catch {
        setError(t("common.error"));
        return;
      }

      if (result.success) {
        router.push(result.redirectTo);
        router.refresh();
        return;
      }

      // The action returns either a field error or a form error; both mean the
      // code was not accepted, so they are shown in one place, at the field.
      const message =
        result.fieldErrors?.villageCode ??
        result.formError ??
        "Invalid village code.";
      setError(translateServerMessage(t, message) ?? t("signup.invalidCode"));
    });
  }

  return (
    <form className="space-y-5" noValidate onSubmit={handleSubmit}>
      <Field
        error={error}
        hint={t("signup.codeHint")}
        id="villageCode"
        label={t("signup.codeLabel")}
        required
      >
        <Input
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          className="font-mono uppercase tracking-wider placeholder:font-sans placeholder:normal-case placeholder:tracking-normal"
          name="villageCode"
          placeholder={t("signup.codePlaceholder")}
          required
          spellCheck={false}
          type="text"
        />
      </Field>

      <Button className="w-full" loading={isPending} size="lg" type="submit">
        {isPending ? t("signup.codeChecking") : t("signup.codeSubmit")}
        {isPending ? null : <ArrowRight aria-hidden />}
      </Button>
    </form>
  );
}
