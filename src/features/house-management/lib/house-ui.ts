// Presentation-only helpers for house management. No server-only imports, so
// both server and client components can use this file. It does NOT decide what
// is allowed (that stays in house-rules.ts); it only picks the translated
// message that explains a rule result the server already computed.
import type { TranslationKey } from "@/lib/i18n/en";

export interface RuleResult {
  allowed: boolean;
  reason?: string;
}

export interface HouseRuleFlags {
  isActive: boolean;
  hasActiveOrPendingMembers: boolean;
}

export interface HouseDetailData {
  id: string;
  houseNumber: string;
  isActive: boolean;
  headOfHouseName: string | null;
  memberCount: number;
  paymentCount: number;
  /** ISO strings, so the data can cross the server/client boundary. */
  createdAt: string;
  updatedAt: string;
}

/** A pending member of a house that has no head yet (Chief decides). */
export interface PendingHeadCandidate {
  id: string;
  name: string;
  /** ISO string, so the data can cross the server/client boundary. */
  createdAt: string;
}

export interface HouseDetailRules {
  flags: HouseRuleFlags;
  edit: RuleResult;
  deactivate: RuleResult;
  reactivate: RuleResult;
}

/** Replaces `{name}` placeholders; unknown placeholders are left untouched. */
export function interpolate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** Translation key explaining why deactivation is blocked (active house). */
export function getDeactivateBlockedKey(
  flags: HouseRuleFlags,
): TranslationKey | null {
  if (flags.hasActiveOrPendingMembers)
    return "houses.deactivate.blockedMembers";
  return null;
}
