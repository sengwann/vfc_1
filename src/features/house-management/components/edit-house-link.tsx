"use client";

import Link from "next/link";
import { Lock, Pencil } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n/provider";
import type { RuleResult } from "../lib/house-ui";

interface EditHouseLinkProps {
  houseId: string;
  editRules: RuleResult;
}

export function EditHouseLink({ houseId, editRules }: EditHouseLinkProps) {
  const { t } = useTranslation();

  if (editRules.allowed) {
    return (
      <div className="space-y-2">
        <Button asChild className="w-full" variant="outline">
          <Link href={`/village/houses/${houseId}/edit`}>
            <Pencil aria-hidden />
            {t("houses.edit.button")}
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">{t("houses.edit.hint")}</p>
      </div>
    );
  }

  // Blocked: a real disabled button (not a fake link) plus a visible reason.
  return (
    <div className="space-y-3">
      <Button className="w-full" disabled variant="outline">
        <Lock aria-hidden />
        {t("houses.edit.button")}
      </Button>
      {editRules.reason ? <Alert tone="info">{editRules.reason}</Alert> : null}
    </div>
  );
}
