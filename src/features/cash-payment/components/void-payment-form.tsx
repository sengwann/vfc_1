"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { useTranslation } from "@/lib/i18n/provider";
import { voidPaymentAction } from "../actions/void-payment.action";

export function VoidPaymentForm({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await voidPaymentAction(formData);

      if (result.success) {
        router.push("/village/cash");
        router.refresh();
        return;
      }

      setFieldErrors(result.fieldErrors ?? {});
      setError(result.error ?? t("cashPay.void.errorGeneric"));
    });
  }

  return (
    <form
      className="space-y-4 rounded-lg border border-danger-border bg-danger-soft/40 p-3 sm:p-4"
      onSubmit={handleSubmit}
    >
      <input name="paymentId" type="hidden" value={paymentId} />

      <Alert tone="warning">{t("cashPay.void.warning")}</Alert>

      <Field
        error={fieldErrors.voidReason}
        hint={t("cashPay.void.reasonHint")}
        id={`void-reason-${paymentId}`}
        label={t("cashPay.void.reason")}
        required
      >
        <Textarea
          name="voidReason"
          placeholder={t("cashPay.void.reasonPlaceholder")}
          rows={3}
        />
      </Field>

      {error ? (
        <Alert title={t("cashPay.void.errorTitle")} tone="danger">
          {error}
        </Alert>
      ) : null}

      <Button
        className="w-full"
        loading={isPending}
        type="submit"
        variant="destructive"
      >
        {isPending ? t("cashPay.void.submitting") : t("cashPay.void.submit")}
      </Button>
    </form>
  );
}
