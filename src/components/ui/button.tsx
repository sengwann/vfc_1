import * as React from "react";
import { cn } from "@/lib/utils";
import { SpinnerIcon } from "./icons";

export type ButtonVariant =
  | "default"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link";

export type ButtonSize = "default" | "sm" | "lg" | "icon";

/*
 * Labels may be long (Burmese strings, translated phrases), so buttons grow in
 * height and wrap instead of forcing a fixed height with `nowrap`. Heights are
 * minimums: 44px by default, and `sm` is raised to 44px on touch devices.
 */
const BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg text-center text-sm font-semibold leading-snug transition-colors select-none " +
  "disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 " +
  "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";

const SIZES: Record<ButtonSize, string> = {
  default: "min-h-11 px-4 py-2.5",
  sm: "min-h-9 px-3 py-1.5 pointer-coarse:min-h-11",
  lg: "min-h-12 px-6 py-3 text-base [&_svg]:size-5",
  icon: "size-11 p-0",
};

const VARIANTS: Record<ButtonVariant, string> = {
  default:
    "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-primary-hover",
  destructive:
    "bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive-hover active:bg-destructive-hover",
  outline:
    "border border-input bg-card text-foreground shadow-xs hover:bg-muted active:bg-muted",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-border active:bg-border",
  ghost: "text-foreground hover:bg-muted active:bg-muted",
  link: "min-h-0 rounded-sm p-0 text-primary underline-offset-4 hover:underline",
};

export function buttonVariants({
  variant,
  size,
  className,
}: {
  variant?: ButtonVariant | null;
  size?: ButtonSize | null;
  className?: string;
} = {}): string {
  return cn(
    BASE,
    SIZES[size ?? "default"],
    VARIANTS[variant ?? "default"],
    className,
  );
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant | null;
  size?: ButtonSize | null;
  /**
   * Render the single child element (e.g. a Next.js <Link>) with the button
   * styles instead of a <button>. Props are passed to the child.
   */
  asChild?: boolean;
  /**
   * Shows a spinner, sets aria-busy and disables the button. Only applies to a
   * real <button>, not to `asChild`.
   */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    asChild = false,
    loading = false,
    disabled,
    children,
    ...props
  },
  ref,
) {
  const classes = buttonVariants({ variant, size, className });

  if (asChild) {
    const child = React.Children.only(children);
    if (React.isValidElement<Record<string, unknown>>(child)) {
      return React.cloneElement(child, {
        ...props,
        ...(ref ? { ref } : {}),
        // Anchors cannot be natively disabled: expose it and remove the tab stop.
        ...(disabled ? { "aria-disabled": true, tabIndex: -1 } : {}),
        className: cn(classes, child.props.className as string | undefined),
      });
    }
  }

  return (
    <button
      aria-busy={loading || undefined}
      className={classes}
      disabled={disabled || loading}
      ref={ref}
      {...props}
    >
      {loading ? <SpinnerIcon className="animate-spin" /> : null}
      {children}
    </button>
  );
});

Button.displayName = "Button";

export { Button };
