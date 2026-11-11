"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { FormEvent } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { useTranslation } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import {
  fillTemplate,
  getActionLabel,
  getEntityLabel,
} from "../lib/audit-labels";

/*
 * Phones (<md): the fields sit behind a "Filters" toggle that shows how many
 * filters are active. md and up: the fields are always visible.
 * Submitting still navigates with the same query parameters as before.
 */
export function AuditFiltersForm({
  basePath,
  actionTypeOptions,
  entityTypeOptions,
  entityTypesByAction,
  initialActionType,
  initialEntityType,
  initialDateFrom,
  initialDateTo,
  showEntityTypeFilter,
}: {
  basePath: string;
  actionTypeOptions: string[];
  entityTypeOptions: string[];
  entityTypesByAction: Record<string, string[]>;
  initialActionType: string;
  initialEntityType: string;
  initialDateFrom: string;
  initialDateTo: string;
  showEntityTypeFilter: boolean;
}) {
  const router = useRouter();
  const { t } = useTranslation();
  const panelId = useId();
  const [isPending, startTransition] = useTransition();

  const [actionType, setActionType] = useState(initialActionType);
  const [entityType, setEntityType] = useState(initialEntityType);
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);

  const activeCount = [
    initialActionType,
    showEntityTypeFilter ? initialEntityType : "",
    initialDateFrom,
    initialDateTo,
  ].filter(Boolean).length;
  const hasActiveFilters = activeCount > 0;

  const [open, setOpen] = useState(hasActiveFilters);

  /*
   * Entity types offered for an action. The page's mapping is honoured; values
   * that are not real entity types are dropped, and actions without a usable
   * mapping fall back to every entity type instead of an empty list.
   */
  function resolveEntityOptions(action: string): string[] {
    if (!action) {
      return entityTypeOptions;
    }
    const mapped = entityTypesByAction[action];
    if (!mapped) {
      return entityTypeOptions;
    }
    const valid = mapped.filter((option) => entityTypeOptions.includes(option));
    return valid.length > 0 ? valid : entityTypeOptions;
  }

  const availableEntityTypes = resolveEntityOptions(actionType);

  function handleActionTypeChange(next: string) {
    setActionType(next);
    if (entityType && !resolveEntityOptions(next).includes(entityType)) {
      setEntityType("");
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();

    if (actionType) {
      params.set("actionType", actionType);
    }
    if (entityType && showEntityTypeFilter) {
      params.set("entityType", entityType);
    }
    if (dateFrom) {
      params.set("dateFrom", dateFrom);
    }
    if (dateTo) {
      params.set("dateTo", dateTo);
    }

    const query = params.toString();
    startTransition(() => {
      router.push(query ? `${basePath}?${query}` : basePath);
    });
  }

  function handleReset() {
    setActionType("");
    setEntityType("");
    setDateFrom("");
    setDateTo("");
    startTransition(() => {
      router.push(basePath);
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <Button
          aria-controls={panelId}
          aria-expanded={open}
          className="w-full justify-between md:hidden"
          onClick={() => setOpen((value) => !value)}
          type="button"
          variant="outline"
        >
          <span className="flex min-w-0 items-center gap-2">
            <SlidersHorizontal aria-hidden />
            {t("audit.filters.title")}
            {hasActiveFilters ? (
              <Badge variant="info">
                {fillTemplate(t("audit.filters.activeCount"), {
                  count: activeCount,
                })}
              </Badge>
            ) : null}
          </span>
          <ChevronDown
            aria-hidden
            className={cn("transition-transform", open && "rotate-180")}
          />
        </Button>

        <form
          className={cn("space-y-4", open ? "block" : "hidden", "md:block")}
          id={panelId}
          onSubmit={handleSubmit}
        >
          <div
            className={cn(
              "grid gap-4 sm:grid-cols-2",
              showEntityTypeFilter ? "lg:grid-cols-4" : "lg:grid-cols-3",
            )}
          >
            <Field id="audit-actionType" label={t("audit.filters.action")}>
              <Select
                onChange={(event) => handleActionTypeChange(event.target.value)}
                value={actionType}
              >
                <option value="">{t("audit.filters.allActions")}</option>
                {actionTypeOptions.map((option) => (
                  <option key={option} value={option}>
                    {getActionLabel(t, option)}
                  </option>
                ))}
              </Select>
            </Field>

            {showEntityTypeFilter ? (
              <Field id="audit-entityType" label={t("audit.filters.entity")}>
                <Select
                  onChange={(event) => setEntityType(event.target.value)}
                  value={entityType}
                >
                  <option value="">{t("audit.filters.allEntities")}</option>
                  {availableEntityTypes.map((option) => (
                    <option key={option} value={option}>
                      {getEntityLabel(t, option)}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <Field id="audit-dateFrom" label={t("audit.filters.from")}>
              <Input
                onChange={(event) => setDateFrom(event.target.value)}
                type="date"
                value={dateFrom}
              />
            </Field>

            <Field id="audit-dateTo" label={t("audit.filters.to")}>
              <Input
                onChange={(event) => setDateTo(event.target.value)}
                type="date"
                value={dateTo}
              />
            </Field>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {hasActiveFilters ? (
              <Button
                disabled={isPending}
                onClick={handleReset}
                type="button"
                variant="outline"
              >
                {t("audit.filters.reset")}
              </Button>
            ) : null}
            <Button loading={isPending} type="submit">
              {isPending
                ? t("audit.filters.applying")
                : t("audit.filters.apply")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
