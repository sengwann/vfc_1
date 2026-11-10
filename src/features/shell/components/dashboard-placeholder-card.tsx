"use client";

import { Badge } from "../../../components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { EmptyState } from "../../../components/ui/empty-state";
import { useTranslation } from "../../../lib/i18n/provider";

export function DashboardPlaceholderCard({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge?: string;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle as="h2" className="text-sm">
          {title}
        </CardTitle>
        <Badge variant="neutral">{badge ?? t("shell.soon")}</Badge>
      </CardHeader>
      <CardContent>
        <EmptyState description={description} title={t("shell.comingSoon")} />
      </CardContent>
    </Card>
  );
}
