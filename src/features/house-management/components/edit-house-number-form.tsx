"use client";

import Link from "next/link";
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
  updateHouseNumberAction,
  type UpdateHouseActionResult,
} from "../actions/update-house-number.action";
import { getHouseErrorText } from "../lib/house-error-text";
import { interpolate } from "../lib/house-ui";

export function EditHouseNumberForm({
  houseId,
  currentHouseNumber,
}: {
  houseId: string;
  currentHouseNumber: string;
}) {
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
      const result: UpdateHouseActionResult = await updateHouseNumberAction(
        houseId,
        formData,
      );
      if (result.success) {
        router.push(`/village/houses/${houseId}`);
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

      // OWNER-APPROVED: refresh-and-retry wording for stale/missing house.
      if (result.formError === "stale") {
        setFormError(t("houses.editPage.stale"));
        return;
      }

      setFormError(t("houses.editPage.generic"));
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        backHref={`/village/houses/${houseId}`}
        backLabel={t("common.back")}
        description={t("houses.editPage.description")}
        title={t("houses.editPage.title")}
      />

      <form className="space-y-6" noValidate onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle as="h2">{t("houses.editPage.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              {interpolate(t("houses.editPage.current"), {
                number: currentHouseNumber,
              })}
            </p>
            <Field
              error={fieldErrors.houseNumber}
              hint={t("houses.form.hint")}
              id="houseNumber"
              label={t("houses.form.houseNumber")}
              required
            >
              <Input
                autoComplete="off"
                defaultValue={currentHouseNumber}
                maxLength={30}
                name="houseNumber"
                ref={houseNumberRef}
                required
                spellCheck={false}
                type="text"
              />
            </Field>
          </CardContent>
        </Card>

        {formError ? (
          <Alert tone="danger" title={t("houses.editPage.errorTitle")}>
            {formError}
          </Alert>
        ) : null}

        {/* Cancel comes first in the DOM; on phones the order is reversed so
            the primary action sits on top. */}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            asChild
            className="w-full sm:w-auto"
            disabled={isPending}
            variant="outline"
          >
            <Link href={`/village/houses/${houseId}`}>
              {t("common.cancel")}
            </Link>
          </Button>
          <Button
            className="w-full sm:w-auto"
            loading={isPending}
            type="submit"
          >
            {isPending
              ? t("houses.editPage.submitting")
              : t("houses.editPage.submit")}
          </Button>
        </div>
      </form>
    </div>
  );
}
