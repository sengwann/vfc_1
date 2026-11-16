"use client";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { useTranslation } from "@/lib/i18n/provider";
import type { HistoryParams } from "../lib/history-filters";

export function HistoryFiltersForm({ basePath, params, funds, invalid }: {
  basePath: string; params: HistoryParams; funds: { id: string; name: string }[]; invalid: boolean;
}) {
  const { t } = useTranslation();
  const first = (key: string) => { const value = params[key]; return Array.isArray(value) ? value[0] ?? "" : value ?? ""; };
  const selected = first("fundId");
  return <form action={basePath} method="get" className="grid gap-3 sm:grid-cols-2">
    <Field id="history-fund" label={t("history.fund")}><Select name="fundId" defaultValue={selected}>
      <option value="">{t("history.all")}</option>
      {selected && !funds.some((fund) => fund.id === selected) ? <option value={selected}>{t("history.unavailable")}</option> : null}
      {funds.map((fund) => <option value={fund.id} key={fund.id}>{fund.name}</option>)}
    </Select></Field>
    <Field id="history-status" label={t("history.status")}><Select name="status" defaultValue={first("status")}>
      <option value="">{t("history.all")}</option>
      {first("status") && !["ACCEPTED", "VOIDED"].includes(first("status")) ? <option value={first("status")}>{t("history.invalid")}</option> : null}
      <option value="ACCEPTED">{t("cashPay.status.accepted")}</option><option value="VOIDED">{t("cashPay.status.voided")}</option>
    </Select></Field>
    <Field id="history-from" label={t("history.from")}><Input name="dateFrom" type={invalid ? "text" : "date"} placeholder="YYYY-MM-DD" defaultValue={first("dateFrom")} /></Field>
    <Field id="history-to" label={t("history.to")}><Input name="dateTo" type={invalid ? "text" : "date"} placeholder="YYYY-MM-DD" defaultValue={first("dateTo")} /></Field>
    <p className="text-sm sm:col-span-2">{t("history.timezone")}</p>
    <Button type="submit">{t("history.apply")}</Button>
    <a href={basePath}>{t("history.reset")}</a>
  </form>;
}
