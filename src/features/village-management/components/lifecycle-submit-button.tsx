"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";

/*
 * Submit button for a lifecycle <form action={serverAction}>. It shows a
 * spinner and disables itself while the action runs, which prevents double
 * submits. Presentation only: the form and action stay with the caller.
 */
export function LifecycleSubmitButton({
  children,
  ...props
}: Omit<ButtonProps, "type" | "loading">) {
  const { pending } = useFormStatus();

  return (
    <Button loading={pending} type="submit" {...props}>
      {children}
    </Button>
  );
}
