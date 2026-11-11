import type { TranslationKey } from "@/lib/i18n/en";
import { useTranslation } from "@/lib/i18n/provider";

export { getPeriodStatus } from "../lib/collector-period";
export type { PeriodStatus } from "../lib/collector-period";

/* Month names come from the dictionaries so they follow the app language. */
export const MONTH_KEYS = [
  "collectors.month.1",
  "collectors.month.2",
  "collectors.month.3",
  "collectors.month.4",
  "collectors.month.5",
  "collectors.month.6",
  "collectors.month.7",
  "collectors.month.8",
  "collectors.month.9",
  "collectors.month.10",
  "collectors.month.11",
  "collectors.month.12",
] as const satisfies readonly TranslationKey[];

/** Returns a formatter such as (2026, 10) => "October 2026". Client use only. */
export function usePeriodLabel(): (year: number, month: number) => string {
  const { t } = useTranslation();

  return (year, month) => {
    const key = MONTH_KEYS[month - 1];
    if (!key) {
      return `${year}-${String(month).padStart(2, "0")}`;
    }
    return `${t(key)} ${year}`;
  };
}
