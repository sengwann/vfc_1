import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { InboxIcon } from "./icons";

/*
 * Props title / description / action / className are unchanged, so all existing
 * call sites keep working. `icon` is optional: omit it for the default glyph,
 * or pass `null` to render no icon.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  const glyph = icon === undefined ? <InboxIcon /> : icon;

  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-xl border border-dashed border-border-strong bg-card/60 px-4 py-8 text-center sm:px-8 sm:py-10",
        className,
      )}
    >
      {glyph ? (
        <div
          aria-hidden="true"
          className="mb-3 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5"
        >
          {glyph}
        </div>
      ) : null}
      <h3 className="max-w-prose text-sm font-semibold text-foreground text-balance">
        {title}
      </h3>
      {description ? (
        <p className="mt-1.5 max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action}
        </div>
      ) : null}
    </div>
  );
}
