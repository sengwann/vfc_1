"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { useTranslation } from "@/lib/i18n/provider";
import { formatAmount } from "@/lib/utils";
import {
  recordCashPaymentAction,
  type RecordCashPaymentActionResult,
} from "../actions/record-cash-payment.action";
import { formatMessage } from "./format-message";

export interface HouseOption {
  id: string;
  houseNumber: string;
  assessmentAmount: number;
  members: { id: string; name: string }[];
}

export function CashPaymentForm({
  houses,
  fundId,
  termsVersion,
  minimumAmount,
}: {
  houses: HouseOption[];
  fundId: string;
  termsVersion: number;
  minimumAmount: number;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [selectedHouseId, setSelectedHouseId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");

  const selectedHouse = houses.find((h) => h.id === selectedHouseId);
  const availableMembers = selectedHouse?.members ?? [];
  const selectedMinimum = selectedHouse?.assessmentAmount ?? minimumAmount;
  const minimumLabel = formatAmount(selectedMinimum);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setSuccess(false);

    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      const result: RecordCashPaymentActionResult =
        await recordCashPaymentAction(formData);

      if (result.success) {
        form.reset();
        setSelectedHouseId("");
        setAmount("");
        setSuccess(true);
        router.refresh();
        return;
      }

      const errors = result.fieldErrors ?? {};
      setFieldErrors(errors);
      setFormError(
        result.formError ??
          (Object.keys(errors).length > 0
            ? t("cashPay.form.fixFields")
            : t("cashPay.form.errorGeneric")),
      );
    });
  }

  return (
    <Card>
      <form noValidate onSubmit={handleSubmit}>
        <input type="hidden" name="fundId" value={fundId} />
        <input type="hidden" name="termsVersion" value={termsVersion} />
        <CardHeader>
          <CardTitle as="h2">{t("cashPay.form.title")}</CardTitle>
          <CardDescription>{t("cashPay.form.description")}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          <Field
            error={fieldErrors.houseId}
            id="houseId"
            label={t("cashPay.form.house")}
            required
          >
            <Select
              defaultValue=""
              name="houseId"
              onChange={(e) => setSelectedHouseId(e.target.value)}
            >
              <option disabled value="">
                {t("cashPay.form.housePlaceholder")}
              </option>
              {houses.map((house) => (
                <option key={house.id} value={house.id}>
                  {formatMessage(t("cashPay.form.houseOption"), {
                    number: house.houseNumber,
                  })}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            error={fieldErrors.payerUserId}
            id="payerUserId"
            label={t("cashPay.form.payer")}
            required
          >
            <Select
              defaultValue=""
              disabled={!selectedHouseId}
              key={selectedHouseId}
              name="payerUserId"
            >
              <option disabled value="">
                {selectedHouseId
                  ? t("cashPay.form.payerPlaceholder")
                  : t("cashPay.form.payerFirst")}
              </option>
              {availableMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          </Field>

          {selectedHouseId && availableMembers.length === 0 ? (
            <Alert tone="warning">{t("cashPay.form.noMembers")}</Alert>
          ) : null}

          <div className="space-y-2">
            <Field
              error={fieldErrors.amount}
              hint={formatMessage(t("cashPay.form.amountHint"), {
                amount: minimumLabel,
              })}
              id="amount"
              label={t("cashPay.form.amount")}
              required
            >
              <Input
                autoComplete="off"
                inputMode="numeric"
                name="amount"
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                placeholder={formatMessage(
                  t("cashPay.form.amountPlaceholder"),
                  {
                    amount: minimumLabel,
                  },
                )}
                type="text"
                value={amount}
              />
            </Field>
            <Button
              onClick={() => setAmount(String(selectedMinimum))}
              size="sm"
              type="button"
              variant="secondary"
            >
              {formatMessage(t("cashPay.form.useMinimum"), {
                amount: minimumLabel,
              })}
            </Button>
          </div>

          {formError ? (
            <Alert title={t("cashPay.form.errorTitle")} tone="danger">
              {formError}
            </Alert>
          ) : null}

          {success ? (
            <Alert tone="success">{t("cashPay.form.success")}</Alert>
          ) : null}

          <Button
            className="w-full"
            disabled={!selectedHouseId || availableMembers.length === 0}
            loading={isPending}
            size="lg"
            type="submit"
          >
            {isPending
              ? t("cashPay.form.submitting")
              : t("cashPay.form.submit")}
          </Button>
        </CardContent>
      </form>
    </Card>
  );
}
