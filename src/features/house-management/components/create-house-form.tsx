"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { useTranslation } from "@/lib/i18n/provider";
import {
  createHouseAction,
  type CreateHouseActionResult,
} from "../actions/create-house.action";
import { getHouseErrorText } from "../lib/house-error-text";

export function CreateHouseForm() {
  const router = useRouter();
  const { t, language } = useTranslation();
  const errorText = getHouseErrorText(language);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [isPending, startTransition] = useTransition();
  const houseNumberRef = useRef<HTMLInputElement>(null);

  // Move keyboard / screen-reader focus to the field that needs fixing.
  useEffect(() => {
    if (fieldErrors.houseNumber) houseNumberRef.current?.focus();
  }, [fieldErrors]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result: CreateHouseActionResult = await createHouseAction(formData);
      if (result.success) {
        router.push(`/village/houses/${result.houseId}`);
        router.refresh();
        return;
      }

      const code = result.fieldErrors?.houseNumber;
      if (code) {
        // A field error is specific enough; do not add the generic alert.
        setFieldErrors({ houseNumber: errorText[code] });
        setFormError(null);
        return;
      }

      setFormError(t("houses.create.generic"));
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/village/houses"
        backLabel={t("houses.back")}
        description={t("houses.create.description")}
        title={t("houses.create.title")}
      />

      <form className="space-y-6" noValidate onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle as="h2">{t("houses.create.cardTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Field
              error={fieldErrors.houseNumber}
              hint={t("houses.form.hint")}
              id="houseNumber"
              label={t("houses.form.houseNumber")}
              required
            >
              <Input
                autoComplete="off"
                maxLength={30}
                name="houseNumber"
                placeholder={t("houses.create.placeholder")}
                ref={houseNumberRef}
                required
                spellCheck={false}
                type="text"
              />
            </Field>
          </CardContent>
        </Card>

        {formError ? (
          <Alert tone="danger" title={t("houses.create.errorTitle")}>
            {formError}
          </Alert>
        ) : null}

        <Button
          className="w-full sm:w-auto"
          loading={isPending}
          size="lg"
          type="submit"
        >
          {isPending
            ? t("houses.create.submitting")
            : t("houses.create.submit")}
        </Button>
      </form>
    </div>
  );
}
