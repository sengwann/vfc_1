import type { LanguagePreference } from "@prisma/client";
import Link from "next/link";

import { Alert } from "@/components/ui/alert";
import { getT } from "@/lib/i18n/translations";
import { formatYangonDateTime } from "@/lib/utils";

import { CHIEF_DEACTIVATION_PATH } from "../lib/deactivation-results";
import { fillTemplate } from "../lib/deactivation-view";

/*
 * Shown on every village page while an approved deactivation is counting down,
 * so nobody is surprised when an action is refused. Presentation only: the
 * read-only rule itself is enforced in each mutation, not by this banner.
 */
export function VillageReadOnlyBanner({
  deadline,
  language,
  isChief,
}: {
  deadline: Date;
  language: LanguagePreference;
  isChief: boolean;
}) {
  const t = getT(language);

  return (
    <Alert
      action={
        isChief ? (
          <Link
            className="text-sm font-semibold underline"
            href={CHIEF_DEACTIVATION_PATH}
          >
            {t("deact.banner.open")}
          </Link>
        ) : undefined
      }
      className="mb-4"
      title={t("deact.banner.title")}
      tone="warning"
    >
      {fillTemplate(t("deact.banner.body"), {
        deadline: formatYangonDateTime(deadline),
      })}
    </Alert>
  );
}
