"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Search, X } from "lucide-react";
import { VillageStatus } from "@prisma/client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { VillageStatusBadge } from "@/features/village-management/components/village-status-badge";
import { fillTemplate } from "@/features/village-management/lib/fill-template";
import type { TranslationKey } from "@/lib/i18n/en";
import { useTranslation } from "@/lib/i18n/provider";
import { cn, formatYangonDateTime } from "@/lib/utils";

interface Village {
  id: string;
  villageCode: string;
  name: string;
  status: VillageStatus;
  createdAt: Date;
}

type StatusFilter = "ALL" | VillageStatus;

const FILTERS: StatusFilter[] = [
  "ALL",
  VillageStatus.ACTIVE,
  VillageStatus.SUSPENDED,
  VillageStatus.DEACTIVATED,
];

const STATUS_KEYS: Record<VillageStatus, TranslationKey> = {
  [VillageStatus.ACTIVE]: "adminDashboard.status.active",
  [VillageStatus.SUSPENDED]: "adminDashboard.status.suspended",
  [VillageStatus.DEACTIVATED]: "adminDashboard.status.deactivated",
};

export function VillagesSearch({ villages }: { villages: Village[] }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");

  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = {
      ALL: villages.length,
      [VillageStatus.ACTIVE]: 0,
      [VillageStatus.SUSPENDED]: 0,
      [VillageStatus.DEACTIVATED]: 0,
    };
    for (const village of villages) {
      result[village.status] += 1;
    }
    return result;
  }, [villages]);

  const filteredVillages = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase();

    return villages.filter((village) => {
      const matchesQuery =
        !normalizedQuery ||
        village.villageCode.toUpperCase().includes(normalizedQuery) ||
        village.name.toUpperCase().includes(normalizedQuery);

      const matchesStatus = status === "ALL" || village.status === status;

      return matchesQuery && matchesStatus;
    });
  }, [villages, query, status]);

  const hasActiveFilters = query.trim() !== "" || status !== "ALL";

  function clearAll() {
    setQuery("");
    setStatus("ALL");
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="relative">
          <label className="sr-only" htmlFor="villages-search">
            {t("adminVillages.searchLabel")}
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            autoComplete="off"
            className="ps-10 pe-11 [&::-webkit-search-cancel-button]:hidden"
            enterKeyHint="search"
            id="villages-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("adminVillages.searchPlaceholder")}
            ref={inputRef}
            type="search"
            value={query}
          />
          {query ? (
            <button
              aria-label={t("adminVillages.clearSearch")}
              className="absolute end-0 top-0 flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              type="button"
            >
              <X aria-hidden className="size-5" />
            </button>
          ) : null}
        </div>

        <div
          aria-label={t("adminVillages.filterLabel")}
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0"
          role="group"
        >
          {FILTERS.map((filter) => {
            const selected = status === filter;
            const label =
              filter === "ALL"
                ? t("adminVillages.filterAll")
                : t(STATUS_KEYS[filter]);

            return (
              <button
                aria-pressed={selected}
                className={cn(
                  "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border-strong bg-card text-foreground hover:bg-muted",
                )}
                key={filter}
                onClick={() => setStatus(filter)}
                type="button"
              >
                {selected ? (
                  <Check aria-hidden className="size-4 shrink-0" />
                ) : null}
                <span>{label}</span>
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    selected
                      ? "text-primary-foreground/80"
                      : "text-muted-foreground",
                  )}
                >
                  {counts[filter]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p aria-live="polite" className="text-sm text-muted-foreground">
        {fillTemplate(t("adminVillages.resultCount"), {
          shown: filteredVillages.length,
          total: villages.length,
        })}
      </p>

      {filteredVillages.length === 0 ? (
        <EmptyState
          action={
            hasActiveFilters ? (
              <Button onClick={clearAll} type="button" variant="outline">
                {t("adminVillages.clearFilters")}
              </Button>
            ) : null
          }
          description={t("adminVillages.noMatchBody")}
          icon={<Search />}
          title={t("adminVillages.noMatchTitle")}
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {filteredVillages.map((village) => (
            <li key={village.id}>
              <Card interactive>
                <Link
                  className="flex min-h-16 items-center gap-3 rounded-xl p-4"
                  href={`/admin/villages/${village.id}`}
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                      <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                        {village.villageCode}
                      </p>
                      <VillageStatusBadge
                        label={t(STATUS_KEYS[village.status])}
                        status={village.status}
                      />
                    </div>
                    <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      {village.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      <time dateTime={village.createdAt.toISOString()}>
                        {fillTemplate(t("adminDashboard.created"), {
                          date: formatYangonDateTime(village.createdAt, "date"),
                        })}
                      </time>
                    </p>
                  </div>
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground rtl:rotate-180"
                  />
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
