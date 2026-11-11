import * as React from "react";
import { cn } from "@/lib/utils";

/*
 * Status tones (success / warning / danger / info / neutral) are the ones to use
 * for statuses. Always keep a text label inside the badge: colour (and the
 * optional dot) is reinforcement, never the only signal.
 *
 * default / secondary / destructive / outline are the original variants, kept
 * so existing call sites keep working.
 */
export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info";

const BASE =
  "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-semibold leading-snug";

const VARIANTS: Record<BadgeVariant, string> = {
  default: "border-transparent bg-primary text-primary-foreground",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
  destructive: "border-transparent bg-destructive text-destructive-foreground",
  outline: "border-border-strong bg-transparent text-foreground",
  neutral: "border-border-strong bg-muted text-secondary-foreground",
  success: "border-success-border bg-success-soft text-success-strong",
  warning: "border-warning-border bg-warning-soft text-warning-strong",
  danger: "border-danger-border bg-danger-soft text-danger-strong",
  info: "border-info-border bg-info-soft text-info-strong",
};

const DOTS: Partial<Record<BadgeVariant, string>> = {
  neutral: "bg-muted-foreground",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function badgeVariants({
  variant,
  className,
}: { variant?: BadgeVariant | null; className?: string } = {}): string {
  return cn(BASE, VARIANTS[variant ?? "default"], className);
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant | null;
  /** Adds a small leading dot in the tone colour. */
  dot?: boolean;
}

function Badge({
  className,
  variant,
  dot = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={badgeVariants({ variant, className })} {...props}>
      {dot ? (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            DOTS[variant ?? "default"] ?? "bg-current",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}

export { Badge };
