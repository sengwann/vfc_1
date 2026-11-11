import type { LanguagePreference } from "@prisma/client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { getT } from "@/lib/i18n/translations";
import { formatYangonDateTime } from "@/lib/utils";

import { markRecoveryNotificationsReadAction } from "../actions/mark-recovery-notifications-read.action";
import { listRecoveryNotificationsForUser } from "../lib/recovery-notifications";
import { describeRecoveryNotification } from "../lib/recovery-view";

/**
 * Safeguard 2, the part the member actually sees: after a reset, every unread
 * recovery notice is shown at the top of every page until it is marked read,
 * saying that the password changed, when, and by whom. A "your password was
 * changed" notice is a warning; the others are informational.
 *
 * The reader is always the signed-in user (the caller passes the session's id).
 */
export async function RecoverySecurityNotice({
  userId,
  language,
}: {
  userId: string;
  language: LanguagePreference;
}) {
  const t = getT(language);
  const unread = (await listRecoveryNotificationsForUser(prisma, userId, 20))
    .filter((item) => item.readAt === null)
    .slice(0, 5);

  const rendered = unread
    .map((item) => ({
      item,
      text: describeRecoveryNotification(t, item.type, item.params, (date) =>
        formatYangonDateTime(date),
      ),
    }))
    .filter((entry) => entry.text !== null);

  if (rendered.length === 0) {
    return null;
  }

  return (
    <section aria-label={t("recovery.notices.title")} className="mb-6 space-y-3">
      {rendered.map(({ item, text }) => (
        <Alert
          key={item.id}
          title={text?.title}
          tone={item.type === "RECOVERY_PASSWORD_CHANGED" ? "warning" : "info"}
        >
          <span className="[overflow-wrap:anywhere]">{text?.body}</span>
        </Alert>
      ))}
      <form action={markRecoveryNotificationsReadAction}>
        <Button size="sm" type="submit" variant="outline">
          {t("recovery.notices.markRead")}
        </Button>
      </form>
    </section>
  );
}
