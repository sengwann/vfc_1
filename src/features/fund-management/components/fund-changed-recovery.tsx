"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useTranslation } from "@/lib/i18n/provider";

/** Expected read race. A native GET form reloads the authenticated server page,
 * including without client hydration; it does not reuse a client-router snapshot.
 * retryHref is supplied by the server page, never by a query-string redirect.
 */
export function FundChangedRecovery({ retryHref }: { retryHref: string }) {
  const { t } = useTranslation();
  return (
    <div role="status">
      <EmptyState
        title={t("funds.changed.title")}
        description={t("funds.changed.description")}
        action={
          <form action={retryHref} method="get">
            <Button type="submit">{t("funds.changed.retry")}</Button>
          </form>
        }
      />
    </div>
  );
}
