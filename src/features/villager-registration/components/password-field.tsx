"use client";

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

import { AlertTriangleIcon } from "../../../components/ui/icons";
import { fieldControlClasses } from "../../../components/ui/field";
import { useTranslation } from "../../../lib/i18n/provider";
import { cn } from "../../../lib/utils";

/*
 * Label + password input with a show/hide button. The shared Field primitive
 * wraps a single control, so this small variant wires the same label, hint and
 * error associations around an input with a trailing button.
 */
export function PasswordField({
  id,
  name,
  label,
  hint,
  error,
  autoComplete = "new-password",
  required = false,
}: {
  id: string;
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  autoComplete?: string;
  required?: boolean;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const buttonId = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1.5">
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
      <div className="relative">
        <input
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          autoCapitalize="none"
          autoComplete={autoComplete}
          autoCorrect="off"
          className={cn(fieldControlClasses, "pe-12")}
          id={id}
          name={name}
          required={required}
          spellCheck={false}
          type={visible ? "text" : "password"}
        />
        <button
          aria-controls={id}
          aria-label={
            visible ? t("login.hidePassword") : t("login.showPassword")
          }
          aria-pressed={visible}
          className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-lg text-muted-foreground transition-colors hover:text-foreground"
          id={buttonId}
          onClick={() => setVisible((value) => !value)}
          type="button"
        >
          {visible ? (
            <EyeOff aria-hidden className="size-5" />
          ) : (
            <Eye aria-hidden className="size-5" />
          )}
        </button>
      </div>
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
