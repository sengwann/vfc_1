import "server-only";

import type { VillageStatus } from "@prisma/client";

import { canTransition } from "./village-lifecycle-rules";

/*
 * Lifecycle policy (decided for B03):
 *   SUSPENDED and DEACTIVATED villages are fully blocked. Sign-in is rejected
 *   and existing sessions end on their next request (see getCurrentUser() in
 *   src/lib/auth/session.ts and loginAction). Historical data is preserved and
 *   nothing cascades to dependent records, so reactivation restores access
 *   without data loss. Read-only access for a blocked village is NOT part of
 *   this feature and needs explicit authorization as a separate feature.
 *
 * Owner decision (B03, deactivation is non-cascading):
 *   Deactivation now happens only through the deactivation workflow (approved
 *   request, 24h countdown, automatic completion); a System Admin cannot
 *   deactivate directly. Deactivating a village only changes Village.status and writes an audit
 *   entry. It never changes user memberships, never clears or releases user
 *   emails/phones, and never releases the villageCode. Those identifiers stay
 *   reserved permanently, and the deactivate confirmation tells the admin so.
 *   Moving users of a deactivated village to another village is NOT part of
 *   B03. It needs its own audited account-transfer feature, designed first
 *   around who owns historical Payment/Dispute/AuditLog rows.
 *
 * The transition table itself lives in village-lifecycle-rules.ts (pure, unit
 * tested). These wrappers keep the original exports and `VillageStatus` types.
 */

export function canSuspendVillage(status: VillageStatus): boolean {
  return canTransition("suspend", status);
}

export function canReactivateVillage(status: VillageStatus): boolean {
  return canTransition("reactivate", status);
}

