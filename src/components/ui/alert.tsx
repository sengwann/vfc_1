import * as React from "react";
import { cn } from "@/lib/utils";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  InfoIcon,
  XCircleIcon,
} from "./icons";

export type AlertTone = "info" | "success" | "warning" | "danger";

const TONES: Record<AlertTone, { box: string; icon: React.ReactNode }> = {
  info: {
    box: "border-info-border bg-info-soft text-info-strong",
    icon: <InfoIcon />,
  },
  success: {
    box: "border-success-border bg-success-soft text-success-strong",
    icon: <CheckCircleIcon />,
  },
  warning: {
    box: "border-warning-border bg-warning-soft text-warning-strong",
    icon: <AlertTriangleIcon />,
  },
  danger: {
    box: "border-danger-border bg-danger-soft text-danger-strong",
    icon: <XCircleIcon />,
  },
};

interface AlertProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> {
  tone?: AlertTone;
  title?: React.ReactNode;
  /** Replaces the default tone icon. */
  icon?: React.ReactNode;
  /** Optional trailing action, e.g. a link or button. */
  action?: React.ReactNode;
}

/**
 * Inline message for form errors, success confirmations, warnings and notes.
 * Each tone has its own icon so the meaning does not depend on colour. Errors
 * use role="alert"; the other tones use role="status".
 */
function Alert({
  tone = "info",
  title,
  icon,
  action,
  className,
  children,
  ...props
}: AlertProps) {
  const config = TONES[tone];

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 text-sm sm:p-4",
        config.box,
        className,
      )}
      role={tone === "danger" ? "alert" : "status"}
      {...props}
    >
      <div aria-hidden="true" className="mt-0.5 shrink-0 [&_svg]:size-5">
        {icon ?? config.icon}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="font-semibold leading-snug">{title}</p> : null}
        {children ? <div className="leading-relaxed">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 self-center">{action}</div> : null}
    </div>
  );
}

export { Alert };