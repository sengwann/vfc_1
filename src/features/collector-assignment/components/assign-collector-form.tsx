"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { useTranslation } from "@/lib/i18n/provider";
import {
  assignCollectorAction,
  type AssignCollectorActionResult,
} from "../actions/assign-collector.action";
import { MONTH_KEYS } from "./collector-period";

export function AssignCollectorForm({
  eligibleUsers,
  currentYear,
  currentMonth,
}: {
  eligibleUsers: {
    id: string;
    name: string;
  }[];
  currentYear: number;
  currentMonth: number;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [userId, setUserId] = useState("");
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [isPending, startTransition] = useTransition();

  const yearOptions = [currentYear, currentYear + 1];
  const hasMembers = eligibleUsers.length > 0;

  function handleYearChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextYear = parseInt(event.target.value, 10);
    setYear(nextYear);
    // Past months of the current year are disabled, so move off one if needed.
    if (nextYear === currentYear && month < currentMonth) {
      setMonth(currentMonth);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSuccess(false);
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result: AssignCollectorActionResult =
        await assignCollectorAction(formData);

      if (result.success) {
        setUserId("");
        setSuccess(true);
        router.refresh();
        return;
      }

      setFieldErrors(result.fieldErrors ?? {});
      setFormError(result.formError ?? t("collectors.form.generic"));
    });
  }

  return (
    <Card id="assign-collector">
      <CardHeader>
        <CardTitle as="h2">{t("collectors.form.title")}</CardTitle>
        <CardDescription>{t("collectors.form.description")}</CardDescription>
      </CardHeader>

      <CardContent>
        <form className="space-y-5" noValidate onSubmit={handleSubmit}>
          {!hasMembers ? (
            <Alert title={t("collectors.form.noMembersTitle")} tone="info">
              {t("collectors.form.noMembersBody")}
            </Alert>
          ) : null}

          <Field
            error={fieldErrors.userId}
            hint={t("collectors.form.memberHint")}
            id="userId"
            label={t("collectors.form.member")}
            required
          >
            <Select
              disabled={!hasMembers}
              name="userId"
              onChange={(event) => setUserId(event.target.value)}
              value={userId}
            >
              <option disabled value="">
                {t("collectors.form.memberPlaceholder")}
              </option>
              {eligibleUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              error={fieldErrors.year}
              id="year"
              label={t("collectors.form.year")}
            >
              <Select name="year" onChange={handleYearChange} value={year}>
                {yearOptions.map((optionYear) => (
                  <option key={optionYear} value={optionYear}>
                    {optionYear}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              error={fieldErrors.month}
              id="month"
              label={t("collectors.form.month")}
            >
              <Select
                name="month"
                onChange={(event) => setMonth(parseInt(event.target.value, 10))}
                value={month}
              >
                {MONTH_KEYS.map((key, index) => {
                  const optionMonth = index + 1;
                  const isPast =
                    year === currentYear && optionMonth < currentMonth;
                  return (
                    <option disabled={isPast} key={key} value={optionMonth}>
                      {t(key)}
                    </option>
                  );
                })}
              </Select>
            </Field>
          </div>

          <p className="-mt-2 text-sm text-muted-foreground">
            {t("collectors.form.monthHint")}
          </p>

          {formError ? (
            <Alert title={t("collectors.form.errorTitle")} tone="danger">
              {formError}
            </Alert>
          ) : null}

          {success ? (
            <Alert tone="success">{t("collectors.form.success")}</Alert>
          ) : null}

          <Button
            className="w-full sm:w-auto"
            disabled={!hasMembers}
            loading={isPending}
            type="submit"
          >
            {isPending
              ? t("collectors.form.submitting")
              : t("collectors.form.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
