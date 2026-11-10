import type { LanguagePreference } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/lib/i18n/translations";
import { formatYangonDateTime } from "@/lib/utils";

import { markNotificationsReadAction } from "../../notifications/actions/mark-notifications-read.action";
import { describeNotification } from "../lib/deactivation-view";
import { DeactivationSubmitButton } from "./deactivation-submit-button";

interface Item {
  id: string;
  type: string;
  params: unknown;
  readAt: Date | null;
  createdAt: Date;
}

/*
 * The signed-in user's own deactivation notifications, newest first, with a
 * "mark all as read" button. The text is built from the stored type and params
 * in the reader's language and shown as plain text.
 */
export function DeactivationNotificationsCard({
  items,
  unread,
  language,
}: {
  items: Item[];
  unread: number;
  language: LanguagePreference;
}) {
  const t = getT(language);
  const rendered = items
    .map((item) => ({
      item,
      text: describeNotification(t, item.type, item.params, (date) =>
        formatYangonDateTime(date),
      ),
    }))
    .filter((entry) => entry.text !== null);

  return (
    <Card>
      <CardHeader className="pb-3 sm:pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle as="h2">{t("deact.notifications.title")}</CardTitle>
          {unread > 0 ? (
            <form action={markNotificationsReadAction}>
              <DeactivationSubmitButton size="sm" variant="outline">
                {t("deact.notifications.markRead")}
              </DeactivationSubmitButton>
            </form>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {rendered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t("deact.notifications.empty")}
          </p>
        ) : (
          <ul className="divide-y">
            {rendered.map(({ item, text }) => (
              <li className="space-y-1 py-3 text-sm" key={item.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{text?.title}</span>
                  {item.readAt === null ? (
                    <Badge variant="info">{t("deact.notifications.new")}</Badge>
                  ) : null}
                  <time
                    className="text-xs text-muted-foreground"
                    dateTime={item.createdAt.toISOString()}
                  >
                    {formatYangonDateTime(item.createdAt)}
                  </time>
                </div>
                <p className="text-muted-foreground [overflow-wrap:anywhere]">
                  {text?.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
