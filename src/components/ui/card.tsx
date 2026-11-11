import * as React from "react";
import { cn } from "@/lib/utils";

type CardVariant = "default" | "muted" | "outline";

const CARD_VARIANTS: Record<CardVariant, string> = {
  default: "border bg-card text-card-foreground shadow-xs",
  muted: "border bg-muted/60 text-card-foreground",
  outline: "border border-border-strong bg-transparent text-foreground",
};

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  /** Adds hover feedback for cards that are (or contain) a link. */
  interactive?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = "default", interactive = false, ...props }, ref) => (
    <div
      className={cn(
        "rounded-xl",
        CARD_VARIANTS[variant],
        interactive &&
          "transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-sm",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
Card.displayName = "Card";

/* Padding is tighter on phones (16px) and relaxes to 24px from `sm` up.
   Content/Footer drop their top padding after a header, but keep it when they
   are the first child. */
const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    className={cn("flex flex-col gap-1.5 p-4 sm:p-6", className)}
    ref={ref}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

type CardTitleTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Heading level to render; pick the one that fits the page outline. */
  as?: CardTitleTag;
}

const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, as: Tag = "h3", ...props }, ref) => (
    <Tag
      className={cn(
        "text-base font-semibold leading-snug tracking-tight text-balance",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    className={cn("text-sm text-muted-foreground", className)}
    ref={ref}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    className={cn(
      "p-4 pt-0 first:pt-4 sm:p-6 sm:pt-0 sm:first:pt-6",
      className,
    )}
    ref={ref}
    {...props}
  />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    className={cn(
      "flex flex-wrap items-center gap-3 p-4 pt-0 first:pt-4 sm:p-6 sm:pt-0 sm:first:pt-6",
      className,
    )}
    ref={ref}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
};