import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * A titled block of page content (heading + optional description and actions),
 * for use below a PageHeader. The title is an <h2>; the section is labelled by
 * it for assistive technology.
 *
 *   <Section title="Recent payments" actions={<Link ...>View all</Link>}>
 *     ...list or table...
 *   </Section>
 *
 * It adds no card chrome on purpose: put a <Card> inside when the content
 * needs a surface. Pass already-translated strings.
 */
export interface SectionProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  /** Set when the same id is needed for anchors or aria-labelledby. */
  id?: string;
  className?: string;
}

export function Section({
  title,
  description,
  actions,
  children,
  id,
  className,
}: SectionProps) {
  const headingId = id ? `${id}-heading` : undefined;

  return (
    <section
      aria-labelledby={headingId}
      className={cn("space-y-3", className)}
      id={id}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2
            className="text-base font-semibold leading-snug tracking-tight"
            id={headingId}
          >
            {title}
          </h2>
          {description ? (
            <p className="max-w-prose text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}
