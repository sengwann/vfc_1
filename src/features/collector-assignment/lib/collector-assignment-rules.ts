import "server-only";

import type { PeriodStatus } from "./collector-period";

/**
 * A chief may deactivate an active assignment only for the current or an
 * upcoming period. Past periods are locked so history cannot be rewritten.
 */
export function canDeactivateAssignment(
  isActive: boolean,
  periodStatus: PeriodStatus,
): boolean {
  if (!isActive) {
    return false;
  }

  return periodStatus === "current" || periodStatus === "upcoming";
}
