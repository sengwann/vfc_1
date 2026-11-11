import type { ReactNode } from "react";
import { AlertTriangleIcon } from "@/components/ui/icons";

/*
 * Error line for a group of controls (a radio group, or "email or phone")
 * where no single Field owns the message. Same look as the Field error: an
 * icon plus text, so the meaning does not depend on colour.
 */
export function InlineError({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <p
      className="flex items-start gap-1.5 text-sm font-medium text-danger-strong"
      id={id}
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
