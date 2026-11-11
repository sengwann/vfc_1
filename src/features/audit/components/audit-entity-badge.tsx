import { Badge } from "@/components/ui/badge";
import { humanize } from "../lib/audit-labels";

export function AuditEntityBadge({
  entityType,
  label,
}: {
  entityType: string;
  /** Already-translated text. Falls back to a readable form of the raw value. */
  label?: string;
}) {
  return <Badge variant="outline">{label ?? humanize(entityType)}</Badge>;
}
