"use client";

import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "@/components/ui/button";

/** Spinner and double-submit protection for the deactivation forms. */
export function DeactivationSubmitButton({
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
