import type { LanguagePreference } from "@prisma/client";
import { getT } from "@/lib/i18n/translations";
import {
  formatMetadataValue,
  getMetadataEntries,
  getMetadataKeyLabel,
  isStructuredValue,
} from "../lib/audit-labels";

/*
 * Label above value on phones so long IDs and Burmese text wrap freely; side by
 * side from `sm` up. Nested objects are shown as wrapped code text.
 */
export function AuditMetadataViewer({
  metadata,
  language,
}: {
  metadata: unknown;
  language: LanguagePreference;
}) {
  const t = getT(language);
  const entries = getMetadataEntries(metadata);

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("audit.detail.noDetails")}
      </p>
    );
  }

  return (
    <dl className="divide-y text-sm">
      {entries.map(([key, value]) => (
        <div
          className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
          key={key}
        >
          <dt className="shrink-0 text-muted-foreground">
            {getMetadataKeyLabel(t, key)}
          </dt>
          <dd className="min-w-0 font-medium [overflow-wrap:anywhere] sm:text-right">
            {isStructuredValue(value) ? (
              <code className="block rounded-md bg-muted px-2 py-1.5 text-left font-mono text-xs font-normal">
                {formatMetadataValue(t, key, value)}
              </code>
            ) : (
              formatMetadataValue(t, key, value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
