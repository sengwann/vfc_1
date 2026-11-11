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
  updateFundAction,
  type UpdateFundActionResult,
} from "../actions/update-fund.action";

export function EditFundForm({
  fundId,
  termsVersion,
  initialName,
  initialDescription,
  initialTargetAmount,
  initialStartDate,
  initialEndDate,
}: {
  fundId: string;
  termsVersion: number;
  initialName: string;
  initialDescription: string;
  initialTargetAmount: string;
  initialStartDate: string;
  initialEndDate: string;
}) {
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
      const result: UpdateFundActionResult = await updateFundAction(formData);

      if (result.success) {
        router.push(`/village/funds/${fundId}`);
        router.refresh();
        return;
      }

      const errors = result.fieldErrors ?? {};
      setFieldErrors(errors);
      setFormError(
        result.formError ??
          (Object.keys(errors).length > 0
            ? t("funds.form.fixFields")
            : t("funds.edit.generic")),
      );
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        backHref={`/village/funds/${fundId}`}
        backLabel={t("funds.backToFund")}
        description={t("funds.edit.description")}
        title={t("funds.edit.title")}
      />

      <form className="space-y-4" noValidate onSubmit={handleSubmit}>
        <input name="fundId" type="hidden" value={fundId} />
        <input name="termsVersion" type="hidden" value={termsVersion} />

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
                defaultValue={initialName}
                name="name"
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
              <Textarea
                defaultValue={initialDescription}
                name="description"
                rows={3}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle as="h2">{t("funds.form.sectionTarget")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <Field
              error={fieldErrors.targetAmount}
              hint={t("funds.form.targetHint")}
              id="targetAmount"
              label={t("funds.form.targetAmount")}
              required
            >
              <Input
                defaultValue={initialTargetAmount}
                inputMode="numeric"
                min={1}
                name="targetAmount"
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
                <Input
                  defaultValue={initialStartDate}
                  name="startDate"
                  required
                  type="date"
                />
              </Field>
              <Field
                error={fieldErrors.endDate}
                id="endDate"
                label={t("funds.form.endDate")}
                required
              >
                <Input
                  defaultValue={initialEndDate}
                  name="endDate"
                  required
                  type="date"
                />
              </Field>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("funds.form.periodHint")}
            </p>
          </CardContent>
        </Card>

        {formError ? (
          <Alert title={t("funds.edit.errorTitle")} tone="danger">
            {formError}
          </Alert>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button
            className="w-full sm:w-auto"
            disabled={isPending}
            onClick={() => router.push(`/village/funds/${fundId}`)}
            type="button"
            variant="outline"
          >
            {t("common.cancel")}
          </Button>
          <Button
            className="w-full sm:w-auto"
            loading={isPending}
            type="submit"
          >
            {isPending ? t("funds.edit.submitting") : t("funds.edit.submit")}
          </Button>
        </div>
      </form>
    </div>
  );
}
