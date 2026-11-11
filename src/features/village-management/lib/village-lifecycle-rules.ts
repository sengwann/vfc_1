/*
 * Pure village lifecycle transition table. It has no imports, so it can be unit
 * tested directly with the Node test runner (same approach as
 * src/lib/auth/safe-redirect.ts). The server-only wrappers live in
 * village-lifecycle.ts.
 *
 * Transitions:
 *   suspend    ACTIVE                 -> SUSPENDED
 *   reactivate SUSPENDED              -> ACTIVE
 *   deactivate ACTIVE | SUSPENDED     -> DEACTIVATED (final)
 *
 * "deactivate" stays in the table because the deactivation workflow's
 * automatic completion uses it. It is NOT an admin lifecycle action: a System
 * Admin can only suspend or reactivate (see ADMIN_LIFECYCLE_ACTIONS). Direct
 * deactivation outside the approval workflow does not exist.
 */

export type VillageLifecycleStatus = "ACTIVE" | "SUSPENDED" | "DEACTIVATED";

export type VillageLifecycleAction = "suspend" | "reactivate" | "deactivate";

/** The only lifecycle actions a System Admin can run directly. */
export const ADMIN_LIFECYCLE_ACTIONS = ["suspend", "reactivate"] as const;

export type AdminLifecycleAction = (typeof ADMIN_LIFECYCLE_ACTIONS)[number];

export function isAdminLifecycleAction(
  action: unknown,
): action is AdminLifecycleAction {
  return (
    typeof action === "string" &&
    (ADMIN_LIFECYCLE_ACTIONS as readonly string[]).includes(action)
  );
}

export const LIFECYCLE_ALLOWED_FROM: Record<
  VillageLifecycleAction,
  readonly VillageLifecycleStatus[]
> = {
  suspend: ["ACTIVE"],
  reactivate: ["SUSPENDED"],
  deactivate: ["ACTIVE", "SUSPENDED"],
};

export const LIFECYCLE_TARGET_STATUS: Record<
  VillageLifecycleAction,
  VillageLifecycleStatus
> = {
  suspend: "SUSPENDED",
  reactivate: "ACTIVE",
  deactivate: "DEACTIVATED",
};

export function canTransition(
  action: VillageLifecycleAction,
  status: VillageLifecycleStatus,
): boolean {
  return LIFECYCLE_ALLOWED_FROM[action].includes(status);
}