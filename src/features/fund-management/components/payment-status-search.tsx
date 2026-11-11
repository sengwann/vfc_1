"use client";

import { useId, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/field";
import { useTranslation } from "@/lib/i18n/provider";
import { fill } from "@/features/analytics/components/fill";
import {
  searchPaymentStatusAction,
  type PaymentStatusSearchItem,
} from "../actions/search-payment-status.action";

export function PaymentStatusSearchSection({ fundId }: { fundId: string }) {
  const { t } = useTranslation();
  const inputId = useId();
  const [results, setResults] = useState<PaymentStatusSearchItem[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    formData.set("fundId", fundId);

    startTransition(async () => {
      const result = await searchPaymentStatusAction(formData);
      if (result.ok) {
        setResults(result.results);
      } else {
        setResults(null);
        setError(result.error);
      }
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3 sm:pb-3">
        <CardTitle as="h2">{t("dashboard.search.title")}</CardTitle>
        <CardDescription>{t("dashboard.search.desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          noValidate
          onSubmit={handleSubmit}
          role="search"
        >
          <Field
            className="sm:flex-1"
            id={inputId}
            label={t("dashboard.search.label")}
          >
            <Input
              autoComplete="off"
              enterKeyHint="search"
              name="q"
              placeholder={t("dashboard.search.placeholder")}
              type="text"
            />
          </Field>
          <Button
            className="w-full sm:w-auto"
            loading={isPending}
            type="submit"
          >
            {isPending
              ? t("dashboard.search.searching")
              : t("dashboard.search.submit")}
          </Button>
        </form>

        <div aria-live="polite" className="space-y-3">
          {error ? <Alert tone="danger">{error}</Alert> : null}

          {results !== null && results.length === 0 ? (
            <EmptyState
              description={t("dashboard.search.noMatchBody")}
              title={t("dashboard.search.noMatchTitle")}
            />
          ) : null}

          {results !== null && results.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">
                {fill(t("dashboard.search.results"), {
                  count: results.length,
                })}
              </p>
              <ul className="space-y-2">
                {results.map((result) => (
                  <li
                    className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                    key={result.id}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {fill(t("dashboard.search.house"), {
                          number: result.houseNumber,
                        })}
                      </p>
                      <p className="text-sm text-muted-foreground break-words">
                        {result.headName ?? t("dashboard.search.noHead")}
                      </p>
                    </div>
                    {result.paid ? (
                      <Badge dot variant="success">
                        {t("dashboard.search.paid")}
                      </Badge>
                    ) : (
                      <Badge dot variant="neutral">
                        {t("dashboard.search.notPaid")}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
