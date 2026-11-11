"use client";
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useTranslation } from "@/lib/i18n/provider";
import type { TranslationKey } from "@/lib/i18n/en";
import { extendFundAction } from "../actions/extend-fund.action";

// Presentation-only allowlist. Server contracts and thrown failures stay unchanged.
// A Map avoids inherited-property matches for URL-supplied error text.
const rejectionKeys = new Map<string, TranslationKey>([
  ["Only active funds can be extended or closed.", "funds.completion.error.inactive"],
  ["Fund details have changed. Reload the form.", "funds.completion.error.stale"],
  ["Extension date and reason are required.", "funds.completion.error.required"],
  ["Only expired funds can be extended.", "funds.completion.error.notExpired"],
  ["Only funds with unpaid assessments can be extended.", "funds.completion.error.paid"],
  ["New end date must be later than the previous end date.", "funds.completion.error.later"],
  ["Every assessed house must have an accepted payment before closure.", "funds.completion.error.unpaid"],
  ["New end date is invalid.", "funds.completion.error.date"],
  ["Extension reason is required.", "funds.completion.error.reason"],
  ["Fund not found.", "funds.completion.error.missing"],
  ["This village is read-only because it is scheduled for deactivation. No changes can be made.", "funds.completion.error.readOnly"],
]);
export function FundCompletionError({ message }: { message: unknown }) {
  const { t } = useTranslation();
  const key = typeof message === "string" ? rejectionKeys.get(message) : undefined;
  // Unrecognized URL/result text is never rendered as a domain explanation.
  return <Alert tone="danger">{t(key ?? "common.error")}</Alert>;
}

export function ExtendFundForm({ fundId, termsVersion, endDate }: { fundId: string; termsVersion: number; endDate: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const data = new FormData(event.currentTarget);
    start(async () => {
      const result = await extendFundAction(data);
      if (!result.success) { setError(result.formError); return; }
      router.refresh();
    });
  }
  return <form onSubmit={submit} className="space-y-3">
    <input name="fundId" type="hidden" value={fundId} />
    <input name="termsVersion" type="hidden" value={termsVersion} />
    <p className="text-sm">{t("funds.extension.previous")}: {endDate}</p>
    <Field id="extension-date" label={t("funds.extension.date")} required>
      <Input id="extension-date" type="date" name="newEndDate" required />
    </Field>
    <Field id="extension-reason" label={t("funds.extension.reason")} required>
      <Textarea id="extension-reason" name="reason" required />
    </Field>
    {error ? <FundCompletionError message={error} /> : null}
    <Button type="submit" loading={pending}>{t("funds.extension.submit")}</Button>
  </form>;
}
