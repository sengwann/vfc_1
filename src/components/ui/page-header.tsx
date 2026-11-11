import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Standard heading block for every page inside the app shell.
 *
 *   <PageHeader
 *     backHref="/village/funds"
 *     backLabel={t("common.back")}
 *     title="Fund details"
 *     description="..."
 *     meta={<FundStatusBadge ... />}
 *     actions={<Button asChild><Link href="...">Edit</Link></Button>}
 *   />
 *
 * Presentation only, no hooks and no translation: pass already-translated
 * strings. Server and client components can both render it.
 *
 * Phones: back link, title, description, meta, then actions in a row where each
 * action shares the width (so a primary button is a full-width touch target).
 * sm and up: actions sit to the right of the title and keep their own width.
 * Long titles and Burmese text wrap; nothing is truncated.
 */
export interface PageHeaderProps {
  /** Page title. Rendered as the page's single <h1>. */
  title: ReactNode;
  description?: ReactNode;
  /** Small text above the title, e.g. a parent name or step label. */
  eyebrow?: ReactNode;
  /** Where the back link goes. Omit for top-level pages. */
  backHref?: string;
  /** Translated label of the back link, required with backHref. */
  backLabel?: string;
  /** Status badges or short facts shown under the title. */
  meta?: ReactNode;
  /** Buttons or links. Wrap several in a fragment. */
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  backHref,
  backLabel,
  meta,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("space-y-3", className)}>
      {backHref && backLabel ? (
        <Link
          className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          href={backHref}
        >
          <ChevronLeft aria-hidden className="size-4 shrink-0" />
          {backLabel}
        </Link>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="max-w-prose text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
          {meta ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">{meta}</div>
          ) : null}
        </div>

        {actions ? (
          <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end [&>*]:flex-1 sm:[&>*]:flex-none">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}