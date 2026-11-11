export interface HouseRuleContext {
  isActive: boolean;
  hasActiveOrPendingMembers: boolean;
}

/*
 * Payment history no longer blocks a rename (owner decision). The house keeps
 * its stable ID, so payments stay linked, and every rename is audited.
 * Kept as a function so callers and the UI keep one place to ask.
 */
export function canEditHouseNumber(): {
  allowed: boolean;
  reason?: string;
} {
  return { allowed: true };
}

export function canDeactivateHouse(ctx: HouseRuleContext): {
  allowed: boolean;
  reason?: string;
} {
  if (!ctx.isActive) {
    return { allowed: false, reason: "This house is already inactive." };
  }
  if (ctx.hasActiveOrPendingMembers) {
    return {
      allowed: false,
      reason: "A house with active or pending members cannot be deactivated.",
    };
  }
  return { allowed: true };
}

export function canReactivateHouse(ctx: Pick<HouseRuleContext, "isActive">): {
  allowed: boolean;
  reason?: string;
} {
  if (ctx.isActive) {
    return { allowed: false, reason: "This house is already active." };
  }
  return { allowed: true };
}
