import type { AuditActionType } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { getActionTone, humanize } from "../lib/audit-labels";

export function AuditActionBadge({
  actionType,
  label,
}: {
  actionType: AuditActionType;
  /** Already-translated text. Falls back to a readable form of the raw value. */
  label?: string;
}) {
  return (
    <Badge dot variant={getActionTone(actionType)}>
      {label ?? humanize(actionType)}
    </Badge>
  );
}
