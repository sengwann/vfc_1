import * as React from "react";
import { cn } from "@/lib/utils";
import { AlertTriangleIcon } from "./icons";

/*
 * Form presentation primitives. They only style markup: names, values,
 * validation and submission stay with the caller's form and server action.
 *
 * Controls are 16px on phones (prevents iOS zoom-on-focus) and 14px from `sm`.
 * Borders meet the 3:1 non-text contrast requirement. Invalid controls get a
 * danger border AND the Field shows an icon + message, so colour is not the
 * only cue.
 */
export const fieldControlClasses =
  "block min-h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-base text-foreground shadow-xs " +
  "placeholder:text-muted-foreground sm:text-sm " +
  "focus-visible:border-ring " +
  "disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground " +
  "read-only:bg-muted aria-invalid:border-danger aria-invalid:bg-danger-soft/40";

const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type = "text", ...props }, ref) => (
  <input
    className={cn(fieldControlClasses, className)}
    ref={ref}
    type={type}
    {...props}
  />
));
Input.displayName = "Input";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    className={cn(fieldControlClasses, "min-h-24", className)}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = "Textarea";

/* Native <select>, so name/value/required, the keyboard and screen readers all
   behave as usual. The `ui-select` class (see globals.css) restyles the open
   list in browsers that support `appearance: base-select`; elsewhere the
   browser's default list is used. `pr-8` is kept for that fallback only. */
const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    className={cn("ui-select", fieldControlClasses, "pr-8", className)}
    ref={ref}
    {...props}
  />
));
Select.displayName = "Select";

interface FieldProps {
  /** Must match the `id` of the control inside. */
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  /** Shows a visual required marker. Set `required` on the control itself too. */
  required?: boolean;
  className?: string;
  /** A single control element (Input, Select, Textarea or any native control). */
  children: React.ReactElement<Record<string, unknown>>;
}

/**
 * Label + control + hint + error with correct associations. The control gets
 * `id`, `aria-describedby` and (when there is an error) `aria-invalid`
 * injected unless the caller already set them.
 */
function Field({
  id,
  label,
  hint,
  error,
  required = false,
  className,
  children,
}: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  const control = React.cloneElement(children, {
    id: children.props.id ?? id,
    "aria-describedby": children.props["aria-describedby"] ?? describedBy,
    "aria-invalid":
      children.props["aria-invalid"] ?? (error ? true : undefined),
  });

  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="block text-sm font-medium text-foreground" htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden="true" className="ms-0.5 text-danger-strong">
            *
          </span>
        ) : null}
      </label>
      {hint ? (
        <p className="text-sm text-muted-foreground" id={hintId}>
          {hint}
        </p>
      ) : null}
      {control}
      {error ? (
        <p
          className="flex items-start gap-1.5 text-sm font-medium text-danger-strong"
          id={errorId}
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export { Field, Input, Select, Textarea };
