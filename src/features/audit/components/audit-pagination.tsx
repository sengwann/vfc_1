import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LanguagePreference } from "@prisma/client";
import { buttonVariants } from "@/components/ui/button";
import { getT } from "@/lib/i18n/translations";
import { fillTemplate } from "../lib/audit-labels";

export function AuditPagination({
  basePath,
  currentPage,
  totalPages,
  baseQuery,
  language,
}: {
  basePath: string;
  currentPage: number;
  totalPages: number;
  baseQuery: string;
  language: LanguagePreference;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const t = getT(language);

  function buildHref(page: number): string {
    const params = new URLSearchParams(baseQuery);
    params.set("page", String(page));
    return `${basePath}?${params.toString()}`;
  }

  const buttonClass = buttonVariants({ variant: "outline" });

  return (
    <nav
      aria-label={t("audit.pagination.label")}
      className="grid grid-cols-[1fr_auto_1fr] items-center gap-3"
    >
      <div className="justify-self-start">
        {currentPage > 1 ? (
          <Link
            className={buttonClass}
            href={buildHref(currentPage - 1)}
            rel="prev"
          >
            <ChevronLeft aria-hidden className="rtl:rotate-180" />
            {t("audit.pagination.previous")}
          </Link>
        ) : (
          <span aria-disabled="true" className={buttonClass}>
            <ChevronLeft aria-hidden className="rtl:rotate-180" />
            {t("audit.pagination.previous")}
          </span>
        )}
      </div>

      <p
        aria-live="polite"
        className="text-center text-sm tabular-nums text-muted-foreground"
      >
        {fillTemplate(t("audit.pagination.pageOf"), {
          page: currentPage,
          total: totalPages,
        })}
      </p>

      <div className="justify-self-end">
        {currentPage < totalPages ? (
          <Link
            className={buttonClass}
            href={buildHref(currentPage + 1)}
            rel="next"
          >
            {t("audit.pagination.next")}
            <ChevronRight aria-hidden className="rtl:rotate-180" />
          </Link>
        ) : (
          <span aria-disabled="true" className={buttonClass}>
            {t("audit.pagination.next")}
            <ChevronRight aria-hidden className="rtl:rotate-180" />
          </span>
        )}
      </div>
    </nav>
  );
}
