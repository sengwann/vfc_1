"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { useTranslation } from "@/lib/i18n/provider";
import {
  createFundAction,
  type CreateFundActionResult,
} from "../actions/create-fund.action";

export function CreateFundForm() {
  const { t } = useTranslation();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result: CreateFundActionResult = await createFundAction(formData);
      if (result.success) {
        router.push(`/village/funds/${result.fundId}`);
        router.refresh();
        return;
      }
      const errors = result.fieldErrors ?? {};
      setFieldErrors(errors);
      setFormError(
        result.formError ??
          (Object.keys(errors).length > 0
            ? t("funds.form.fixFields")
            : t("funds.create.generic")),
      );
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/village/funds"
        backLabel={t("funds.back")}
        description={t("funds.create.description")}
        title={t("funds.create.title")}
      />

      <form className="space-y-4" noValidate onSubmit={handleSubmit}>
        <Card>
          <CardHeader>
            <CardTitle as="h2">{t("funds.form.sectionDetails")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field
              error={fieldErrors.name}
              hint={t("funds.form.nameHint")}
              id="name"
              label={t("funds.form.name")}
              required
            >
              <Input
                autoComplete="off"
                name="name"
                placeholder={t("funds.form.namePlaceholder")}
                required
                type="text"
              />
            </Field>

            <Field
              error={fieldErrors.description}
              hint={t("funds.form.descriptionHint")}
              id="description"
              label={t("funds.form.description")}
            >
              <Textarea name="description" rows={3} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t("funds.form.sectionTarget")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field
              error={fieldErrors.totalAmount}
              hint={t("funds.create.amountHint")}
              id="totalAmount"
              label={t("funds.form.targetAmount")}
              required
            >
              <Input
                inputMode="numeric"
                min={1}
                name="totalAmount"
                required
                step={1}
                type="number"
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                error={fieldErrors.startDate}
                id="startDate"
                label={t("funds.form.startDate")}
                required
              >
                <Input name="startDate" required type="date" />
              </Field>
              <Field
                error={fieldErrors.endDate}
                id="endDate"
                label={t("funds.form.endDate")}
                required
              >
                <Input name="endDate" required type="date" />
              </Field>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("funds.form.periodHint")}
            </p>
          </CardContent>
        </Card>

        {formError ? (
          <Alert title={t("funds.create.errorTitle")} tone="danger">
            {formError}
          </Alert>
        ) : null}

        <div className="flex sm:justify-end">
          <Button
            className="w-full sm:w-auto"
            loading={isPending}
            type="submit"
          >
            {isPending
              ? t("funds.create.submitting")
              : t("funds.create.submit")}
          </Button>
        </div>
      </form>
    </div>
  );
}
