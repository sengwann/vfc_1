"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, House, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import type { TranslationKey } from "@/lib/i18n/en";
import { useTranslation } from "@/lib/i18n/provider";
import { interpolate } from "../lib/house-ui";
import { HouseStatusBadge } from "./house-status-badge";

interface HouseListItem {
  id: string;
  houseNumber: string;
  isActive: boolean;
}

type StatusFilter = "all" | "active" | "inactive";

const FILTERS: StatusFilter[] = ["all", "active", "inactive"];

const FILTER_LABELS: Record<StatusFilter, TranslationKey> = {
  all: "houses.filter.all",
  active: "houses.filter.active",
  inactive: "houses.filter.inactive",
};

export function HousesDirectory({ houses }: { houses: HouseListItem[] }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const counts = useMemo(
    () => ({
      all: houses.length,
      active: houses.filter((house) => house.isActive).length,
      inactive: houses.filter((house) => !house.isActive).length,
    }),
    [houses],
  );

  const filteredHouses = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase();

    return houses.filter((house) => {
      const matchesQuery =
        !normalizedQuery ||
        house.houseNumber.toUpperCase().includes(normalizedQuery);

      const matchesStatus =
        status === "all" ||
        (status === "active" && house.isActive) ||
        (status === "inactive" && !house.isActive);

      return matchesQuery && matchesStatus;
    });
  }, [houses, query, status]);

  function clearFilters() {
    setQuery("");
    setStatus("all");
  }

  const header = (
    <PageHeader
      actions={
        <Button asChild>
          <Link href="/village/houses/new">
            <Plus aria-hidden />
            {t("houses.list.create")}
          </Link>
        </Button>
      }
      description={t("houses.list.description")}
      title={t("houses.list.title")}
    />
  );

  // Nothing created yet: one clear call to action, no search or filters.
  if (houses.length === 0) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          action={
            <Button asChild>
              <Link href="/village/houses/new">
                <Plus aria-hidden />
                {t("houses.list.emptyAction")}
              </Link>
            </Button>
          }
          description={t("houses.list.emptyBody")}
          icon={<House />}
          title={t("houses.list.emptyTitle")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="space-y-3">
        <div className="relative">
          <label className="sr-only" htmlFor="houses-search">
            {t("houses.list.searchLabel")}
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            autoComplete="off"
            className="pe-11 ps-10"
            enterKeyHint="search"
            id="houses-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("houses.list.searchPlaceholder")}
            value={query}
          />
          {query ? (
            <button
              aria-label={t("houses.list.clearSearch")}
              className="absolute end-0 top-0 inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setQuery("")}
              type="button"
            >
              <X aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>

        <div
          aria-label={t("houses.list.filterLabel")}
          className="flex flex-wrap gap-2"
          role="group"
        >
          {FILTERS.map((value) => (
            <Button
              aria-pressed={status === value}
              key={value}
              onClick={() => setStatus(value)}
              size="sm"
              type="button"
              variant={status === value ? "default" : "outline"}
            >
              {t(FILTER_LABELS[value])}
              <span className="tabular-nums opacity-80">{counts[value]}</span>
            </Button>
          ))}
        </div>

        <p aria-live="polite" className="text-sm text-muted-foreground">
          {interpolate(t("houses.list.resultCount"), {
            shown: filteredHouses.length,
            total: houses.length,
          })}
        </p>
      </div>

      {filteredHouses.length === 0 ? (
        <EmptyState
          action={
            <Button onClick={clearFilters} type="button" variant="outline">
              {t("houses.list.clearFilters")}
            </Button>
          }
          description={t("houses.list.noMatchBody")}
          icon={<Search />}
          title={t("houses.list.noMatchTitle")}
        />
      ) : (
        <ul className="space-y-3">
          {filteredHouses.map((house) => (
            <li key={house.id}>
              <Link
                className="flex min-h-16 items-center gap-3 rounded-xl border bg-card p-3 shadow-xs transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-sm sm:p-4"
                href={`/village/houses/${house.id}`}
              >
                <span
                  aria-hidden="true"
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
                >
                  <House className="size-5" />
                </span>
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="block break-words text-base font-semibold leading-snug">
                    {house.houseNumber}
                  </span>
                  <HouseStatusBadge isActive={house.isActive} />
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-5 shrink-0 text-muted-foreground"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}