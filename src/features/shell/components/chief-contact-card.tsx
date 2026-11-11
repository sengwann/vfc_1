"use client";

import { Phone } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { buttonVariants } from "../../../components/ui/button";
import { useTranslation } from "../../../lib/i18n/provider";

export function ChiefContactCard({
  chiefName,
  chiefPhone,
}: {
  chiefName: string | null;
  chiefPhone: string | null;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="pb-3 sm:pb-3">
        <CardTitle as="h2" className="text-sm">
          {t("shell.chief.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="space-y-2 text-sm">
          <div className="flex items-start justify-between gap-3">
            <dt className="shrink-0 text-muted-foreground">
              {t("shell.chief.name")}
            </dt>
            <dd className="text-right font-medium">{chiefName ?? "—"}</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="shrink-0 text-muted-foreground">
              {t("shell.chief.phone")}
            </dt>
            <dd className="text-right font-medium tabular-nums">
              {chiefPhone ?? "—"}
            </dd>
          </div>
        </dl>
        {chiefPhone ? (
          <a
            className={buttonVariants({ className: "w-full" })}
            href={`tel:${chiefPhone}`}
          >
            <Phone aria-hidden />
            {t("shell.chief.call")}
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}
