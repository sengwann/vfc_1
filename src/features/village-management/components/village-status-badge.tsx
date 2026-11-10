import { VillageStatus } from "@prisma/client";
import { Badge, type BadgeVariant } from "@/components/ui/badge";

const VARIANT_BY_STATUS: Record<VillageStatus, BadgeVariant> = {
  [VillageStatus.ACTIVE]: "success",
  [VillageStatus.SUSPENDED]: "warning",
  [VillageStatus.DEACTIVATED]: "neutral",
};

export function VillageStatusBadge({
  status,
  label,
}: {
  status: VillageStatus;
  /** Already-translated text. Falls back to the raw status value. */
  label?: string;
}) {
  return (
    <Badge dot variant={VARIANT_BY_STATUS[status]}>
      {label ?? status}
    </Badge>
  );
}