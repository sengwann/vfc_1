"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/provider";
import {
  updateSettingsAction,
  type UpdateSettingsActionResult,
} from "../actions/update-settings.action";
import { InlineError } from "./inline-error";
import { useFocusFirstError } from "./use-focus-first-error";

const LANGUAGE_OPTIONS = [
  { value: "EN", labelKey: "language.en" },
  { value: "MY", labelKey: "language.my" },
] as const;

export function UpdateSettingsForm({
  initialTheme,
  initialLanguage,
}: {
  /**
   * Kept optional for compatibility: the settings validator only reads
   * `language`, and the page does not pass a theme. The hidden field is
   * rendered only when a value is provided.
   */
  initialTheme?: string;
  initialLanguage: string;
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
      const result: UpdateSettingsActionResult =
        await updateSettingsAction(formData);
      if (result.success) {
        setSaved(true);
        router.refresh();
        return;
      }
      setFieldErrors(result.fieldErrors ?? {});
      setFormError(result.formError ?? "Unable to update settings.");
    });
  }

  const languageError = fieldErrors.language;

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
      {initialTheme !== undefined ? (
        <input name="theme" type="hidden" value={initialTheme} />
      ) : null}

      <fieldset
        aria-describedby={languageError ? "language-error" : undefined}
        className="min-w-0 space-y-3"
      >
        <legend className="mb-3 text-sm font-medium">
          {t("settings.language")}
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {LANGUAGE_OPTIONS.map((option) => (
            <label
              className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-input bg-card px-4 py-3 text-sm font-medium transition-colors hover:bg-muted has-[:checked]:border-primary has-[:checked]:bg-accent has-[:checked]:text-accent-foreground has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
              key={option.value}
            >
              <input
                aria-invalid={languageError ? true : undefined}
                className="peer sr-only"
                defaultChecked={initialLanguage === option.value}
                name="language"
                type="radio"
                value={option.value}
              />
              {/* Ring when unselected, filled ring with a centre dot when selected. */}
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-input bg-card after:size-2 after:rounded-full after:bg-primary-foreground after:opacity-0 peer-checked:border-primary peer-checked:bg-primary peer-checked:after:opacity-100"
              />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {t(option.labelKey)}
              </span>
            </label>
          ))}
        </div>
        {languageError ? (
          <InlineError id="language-error">{languageError}</InlineError>
        ) : null}
        {fieldErrors.theme ? (
          <InlineError id="theme-error">{fieldErrors.theme}</InlineError>
        ) : null}
      </fieldset>

      {formError ? (
        <div className="outline-none" data-form-error tabIndex={-1}>
          <Alert tone="danger">{formError}</Alert>
        </div>
      ) : null}

      {saved ? <Alert tone="success">{t("settings.saved")}</Alert> : null}

      <div className="flex sm:justify-end">
        <Button className="w-full sm:w-auto" loading={isPending} type="submit">
          {isPending ? t("settings.saving") : t("settings.saveSettings")}
        </Button>
      </div>
    </form>
  );
}
