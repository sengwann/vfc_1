import type {
  RecoveryMembershipStatus,
  RecoveryRole,
  RecoveryVillageStatus,
} from "./recovery-rules";

/*
 * Pure "who may act on whose recovery request" rules (Section 2 of the plan).
 * Imports types only, so it can be unit tested directly.
 *
 *   Target account                        May be handled by
 *   ------------------------------------  ----------------------------------
 *   Villager                              an active Chief of the SAME village
 *   Villager, village has no active Chief any System Admin
 *   Chief                                 any System Admin
 *   System Admin                          a DIFFERENT System Admin
 *   Last System Admin                     nobody here (server-side CLI)
 *
 * "Active Chief" means exactly what requireChief() already enforces: role
 * CHIEF, membership ACTIVE, in a village whose status is ACTIVE. There is no
 * "inactive for X days" rule, because nothing records the last sign-in.
 *
 * The facts passed in (actor, target, number of active Chiefs) must be read
 * from the database by the caller, never from the browser or the session
 * alone. Authority is never stored: it is worked out again on every read and
 * every action, so a Chief who is removed loses access at once and a village
 * that loses its last Chief is handed to the System Admins automatically.
 */

export interface AuthorityActor {
  id: string;
  role: RecoveryRole;
  villageId: string | null;
  membershipStatus: RecoveryMembershipStatus | null;
  /** null for a System Admin. */
  villageStatus: RecoveryVillageStatus | null;
}

export interface AuthorityTarget {
  id: string;
  role: RecoveryRole;
  /** The village the target belonged to when the request was filed. */
  villageId: string | null;
}

export type AuthorityDecision =
  | { allowed: true; as: "VILLAGE_CHIEF" | "SYSTEM_ADMIN" }
  | { allowed: false };

const DENIED: AuthorityDecision = { allowed: false };

/** The actor is a Chief who is currently allowed to act as one. */
export function isActiveChief(actor: AuthorityActor): boolean {
  return (
    actor.role === "CHIEF" &&
    actor.membershipStatus === "ACTIVE" &&
    actor.villageStatus === "ACTIVE" &&
    actor.villageId !== null
  );
}

/**
 * Whether `actor` may reject, issue a code for, or withdraw a code of the
 * request whose account is `target`.
 *
 * activeChiefCountInTargetVillage is the number of active Chiefs (as defined
 * above) in the target's village; it only matters for Villager targets.
 */
export function evaluateAuthority(input: {
  actor: AuthorityActor;
  target: AuthorityTarget;
  activeChiefCountInTargetVillage: number;
}): AuthorityDecision {
  const { actor, target, activeChiefCountInTargetVillage } = input;

  // Nobody handles their own request.
  if (actor.id === target.id) {
    return DENIED;
  }

  if (target.role === "VILLAGER") {
    if (isActiveChief(actor)) {
      // A Chief only ever acts inside their own village.
      return target.villageId !== null && actor.villageId === target.villageId
        ? { allowed: true, as: "VILLAGE_CHIEF" }
        : DENIED;
    }

    if (actor.role === "SYSTEM_ADMIN") {
      return activeChiefCountInTargetVillage === 0
        ? { allowed: true, as: "SYSTEM_ADMIN" }
        : DENIED;
    }

    return DENIED;
  }

  // A Chief or a System Admin can only be handled by a System Admin. A Chief
  // actor is refused here: Chiefs never act on another Chief or on an Admin.
  return actor.role === "SYSTEM_ADMIN"
    ? { allowed: true, as: "SYSTEM_ADMIN" }
    : DENIED;
}

export type ApproverGroup =
  /** Every active Chief of the target's village. */
  | "VILLAGE_CHIEFS"
  /** Every System Admin (a Chief's request, or a village with no active Chief). */
  | "SYSTEM_ADMINS"
  /** Every System Admin except the target. */
  | "OTHER_SYSTEM_ADMINS";

/**
 * Who should be told about a new request (the REQUESTED notification). It
 * mirrors evaluateAuthority, so everyone notified can also act on it.
 */
export function approverGroupFor(input: {
  target: AuthorityTarget;
  activeChiefCountInTargetVillage: number;
}): ApproverGroup {
  const { target, activeChiefCountInTargetVillage } = input;

  if (target.role === "SYSTEM_ADMIN") {
    return "OTHER_SYSTEM_ADMINS";
  }

  if (target.role === "CHIEF") {
    return "SYSTEM_ADMINS";
  }

  return activeChiefCountInTargetVillage > 0
    ? "VILLAGE_CHIEFS"
    : "SYSTEM_ADMINS";
}
