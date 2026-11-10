import "server-only";

export type AssignCollectorField = "userId" | "year" | "month";

const YEAR_MIN = 2020;

export interface NormalizedAssignCollectorInput {
  userId: string;
  year: number;
  month: number;
}

export type AssignCollectorValidationResult =
  | { ok: true; data: NormalizedAssignCollectorInput }
  | {
      ok: false;
      fieldErrors: Partial<Record<AssignCollectorField, string>>;
      formError?: string;
    };

function getFormDataString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

/** Strict integer: rejects "12abc", "1.5", "-1", "" etc. */
function parseStrictInteger(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function validateAssignCollectorInput(
  formData: FormData,
  currentPeriod: { year: number; month: number },
): AssignCollectorValidationResult {
  const fieldErrors: Partial<Record<AssignCollectorField, string>> = {};

  const userId = getFormDataString(formData, "userId");
  const rawYear = getFormDataString(formData, "year");
  const rawMonth = getFormDataString(formData, "month");

  if (!userId) {
    fieldErrors.userId = "Select a village member to assign as Collector.";
  }

  const year = parseStrictInteger(rawYear);
  const month = parseStrictInteger(rawMonth);

  const maxYear = currentPeriod.year + 1;

  if (year === null || year < YEAR_MIN || year > maxYear) {
    fieldErrors.year = `Select a valid year between ${YEAR_MIN} and ${maxYear}.`;
  }

  if (month === null || month < 1 || month > 12) {
    fieldErrors.month = "Select a valid month.";
  }

  if (
    year !== null &&
    month !== null &&
    !fieldErrors.year &&
    !fieldErrors.month
  ) {
    const isPast =
      year < currentPeriod.year ||
      (year === currentPeriod.year && month < currentPeriod.month);

    if (isPast) {
      fieldErrors.month = "Cannot assign a collector for a past period.";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    data: {
      userId,
      year: year as number,
      month: month as number,
    },
  };
}
