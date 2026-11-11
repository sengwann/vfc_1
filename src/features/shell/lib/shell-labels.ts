import type { TranslationKey } from "../../../lib/i18n/en";
import type { BadgeVariant } from "../../../components/ui/badge";
import type { NavItem } from "./navigation";

/*
 * Presentation-only helpers for the shell. Nothing here decides who can see
 * what: navigation items still come, unchanged, from `navigation.ts`.
 */

type Translate = (key: TranslationKey) => string;

const ROLE_KEYS: Record<string, TranslationKey> = {
  SYSTEM_ADMIN: "shell.role.systemAdmin",
  CHIEF: "shell.role.chief",
  VILLAGER: "shell.role.villager",
};

const MEMBERSHIP_KEYS: Record<string, TranslationKey> = {
  ACTIVE: "shell.membership.active",
  PENDING: "shell.membership.pending",
  REJECTED: "shell.membership.rejected",
  REMOVED: "shell.membership.removed",
};

export function getRoleLabel(t: Translate, role: string): string {
  const key = ROLE_KEYS[role];
  return key ? t(key) : role;
}

export function getMembershipLabel(t: Translate, status: string | null) {
  if (!status) return "—";
  const key = MEMBERSHIP_KEYS[status];
  return key ? t(key) : status;
}

export function getMembershipTone(status: string | null): BadgeVariant {
  if (status === "ACTIVE") return "success";
  if (status === "PENDING") return "warning";
  if (status === "REJECTED" || status === "REMOVED") return "danger";
  return "neutral";
}

/** Replaces `{count}` in a translated template. */
export function formatCount(template: string, count: number): string {
  return template.replace("{count}", String(count));
}

/** Up to two initials. Works per code point so Burmese names do not break. */
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0] ?? "";
  const last =
    words.length > 1 ? (Array.from(words[words.length - 1])[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function isNavActive(pathname: string, href?: string): boolean {
  if (!href) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The enabled item whose href is the longest prefix of the current path. */
export function findActiveItem(
  items: NavItem[],
  pathname: string,
): NavItem | null {
  let best: NavItem | null = null;
  for (const item of items) {
    if (item.disabled || !isNavActive(pathname, item.href)) continue;
    if (!best || (item.href?.length ?? 0) > (best.href?.length ?? 0)) {
      best = item;
    }
  }
  return best;
}
