import { useEffect, type RefObject } from "react";

/*
 * After a failed submit, move keyboard and screen-reader focus to the first
 * invalid control (aria-invalid="true"). If only a form-level error exists,
 * focus the element marked data-form-error instead. Presentation behaviour
 * only: it never changes what is submitted or validated.
 */
export function useFocusFirstError(
  formRef: RefObject<HTMLFormElement | null>,
  fieldErrors: Record<string, string | undefined>,
  formError: string | null,
) {
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const hasFieldError = Object.values(fieldErrors).some(Boolean);
    if (!hasFieldError && !formError) return;

    const invalid = form.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (invalid) {
      invalid.focus();
      return;
    }
    form.querySelector<HTMLElement>("[data-form-error]")?.focus();
  }, [formRef, fieldErrors, formError]);
}
