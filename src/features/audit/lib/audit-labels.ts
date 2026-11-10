import type { BadgeVariant } from "@/components/ui/badge";
import type { TranslationKey } from "@/lib/i18n/en";
import { formatYangonDateTime } from "@/lib/utils";

/*
 * Presentation-only helpers for the audit screens: label lookups, tones,
 * day grouping and metadata formatting. No data access, no server-only imports,
 * so both server and client components can use it.
 */

export type Translate = (key: TranslationKey) => string;

const ACTION_KEYS: Record<string, TranslationKey> = {
  CREATE: "audit.action.create",
  UPDATE: "audit.action.update",
  DELETE: "audit.action.delete",
  STATUS_CHANGE: "audit.action.statusChange",
  APPROVE: "audit.action.approve",
  REJECT: "audit.action.reject",
  REMOVE: "audit.action.remove",
  ASSIGN: "audit.action.assign",
  VOID: "audit.action.void",
  ACCEPT: "audit.action.accept",
  LOGIN: "audit.action.login",
  LOGOUT: "audit.action.logout",
  CANCEL: "audit.action.cancel",
  COMPLETE: "audit.action.complete",
};

const ACTION_TONES: Record<string, BadgeVariant> = {
  CREATE: "success",
  UPDATE: "info",
  DELETE: "danger",
  STATUS_CHANGE: "warning",
  APPROVE: "success",
  REJECT: "danger",
  REMOVE: "danger",
  ASSIGN: "info",
  VOID: "neutral",
  ACCEPT: "success",
  LOGIN: "neutral",
  LOGOUT: "neutral",
  CANCEL: "warning",
  COMPLETE: "success",
};

const ENTITY_KEYS: Record<string, TranslationKey> = {
  VILLAGE: "audit.entity.village",
  HOUSE: "audit.entity.house",
  USER: "audit.entity.user",
  FUND: "audit.entity.fund",
  COLLECTOR_ASSIGNMENT: "audit.entity.collectorAssignment",
  PAYMENT: "audit.entity.payment",
  RECEIPT: "audit.entity.receipt",
  SESSION: "audit.entity.session",
  DEACTIVATION_REQUEST: "audit.entity.deactivationRequest",
  PASSWORD_RECOVERY_REQUEST: "audit.entity.passwordRecovery",
};

const METADATA_KEYS: Record<string, TranslationKey> = {
  villageCode: "audit.meta.villageCode",
  name: "audit.meta.name",
  previousStatus: "audit.meta.previousStatus",
  newStatus: "audit.meta.newStatus",
  requestId: "audit.meta.requestId",
  requesterUserId: "audit.meta.requesterUserId",
  reason: "audit.meta.reason",
  outcome: "audit.meta.outcome",
  blockReason: "audit.meta.blockReason",
  approvedAt: "audit.meta.approvedAt",
  scheduledDeactivationAt: "audit.meta.scheduledDeactivationAt",
  rejectedAt: "audit.meta.rejectedAt",
  rejectionReason: "audit.meta.rejectionReason",
  cooldownEndsAt: "audit.meta.cooldownEndsAt",
  cancelledAt: "audit.meta.cancelledAt",
  cancellationReason: "audit.meta.cancellationReason",
  completedAt: "audit.meta.completedAt",
  completedBy: "audit.meta.completedBy",
  readOnly: "audit.meta.readOnly",
  notificationDelivery: "audit.meta.notificationDelivery",
  notificationEvent: "audit.meta.notificationEvent",
  error: "audit.meta.error",
  processingAttempts: "audit.meta.processingAttempts",
  event: "audit.meta.event",
  targetUserId: "audit.meta.targetUserId",
  issuedByUserId: "audit.meta.issuedByUserId",
  issueCount: "audit.meta.issueCount",
  codeExpiresAt: "audit.meta.codeExpiresAt",
  requestExpiresAt: "audit.meta.requestExpiresAt",
  revocationReason: "audit.meta.revocationReason",
  failedAttempts: "audit.meta.failedAttempts",
  clientFingerprint: "audit.meta.clientFingerprint",
  via: "audit.meta.via",
  note: "audit.meta.note",
};

/** Metadata values that are ISO timestamps, shown in Yangon time. */
const DATE_METADATA_KEYS = new Set([
  "approvedAt",
  "scheduledDeactivationAt",
  "rejectedAt",
  "cooldownEndsAt",
  "cancelledAt",
  "completedAt",
  "codeExpiresAt",
  "requestExpiresAt",
]);

const ENUM_VALUE_KEYS: Record<string, TranslationKey> = {
  SUCCESS: "audit.value.success",
  BLOCKED: "audit.value.blocked",
  FAILED: "audit.value.failed",
  PENDING: "deact.status.pending",
  APPROVED: "deact.status.approved",
  REJECTED: "deact.status.rejected",
  CANCELLED: "deact.status.cancelled",
  COMPLETED: "deact.status.completed",
};

const STATUS_VALUE_KEYS: Record<string, TranslationKey> = {
  ACTIVE: "adminDashboard.status.active",
  SUSPENDED: "adminDashboard.status.suspended",
  DEACTIVATED: "adminDashboard.status.deactivated",
};

const STATUS_TONES: Record<string, BadgeVariant> = {
  ACTIVE: "success",
  SUSPENDED: "warning",
  DEACTIVATED: "neutral",
};

const STATUS_METADATA_KEYS = new Set(["previousStatus", "newStatus"]);
const ENUM_METADATA_KEYS = new Set(["outcome", "notificationDelivery"]);

/** "STATUS_CHANGE" or "villageCode" -> "Status change" / "Village code". */
export function humanize(value: string): string {
  const spaced = value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function getActionLabel(t: Translate, actionType: string): string {
  const key = ACTION_KEYS[actionType];
  return key ? t(key) : humanize(actionType);
}

export function getActionTone(actionType: string): BadgeVariant {
  return ACTION_TONES[actionType] ?? "neutral";
}

export function getEntityLabel(t: Translate, entityType: string): string {
  const key = ENTITY_KEYS[entityType];
  return key ? t(key) : humanize(entityType);
}

export function getMetadataKeyLabel(t: Translate, key: string): string {
  const labelKey = METADATA_KEYS[key];
  return labelKey ? t(labelKey) : humanize(key);
}

export function getStatusLabel(t: Translate, value: string): string {
  const key = STATUS_VALUE_KEYS[value] ?? ENUM_VALUE_KEYS[value];
  return key ? t(key) : value;
}

export function getStatusTone(value: string): BadgeVariant {
  return STATUS_TONES[value] ?? "neutral";
}

export function formatMetadataValue(
  t: Translate,
  key: string,
  value: unknown,
): string {
  if (value === null || value === undefined || value === "") {
    return "—";
  }
  if (typeof value === "boolean") {
    return t(value ? "audit.value.yes" : "audit.value.no");
  }
  if (typeof value === "string") {
    if (DATE_METADATA_KEYS.has(key)) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : formatYangonDateTime(date);
    }
    if (ENUM_METADATA_KEYS.has(key)) {
      return ENUM_VALUE_KEYS[value] ? t(ENUM_VALUE_KEYS[value]) : value;
    }
    // Recovery events and revocation reasons are stored as CODE_ISSUED,
    // TOO_MANY_ATTEMPTS and so on: show them as readable words.
    if (key === "event" || key === "revocationReason") {
      return humanize(value);
    }
    return STATUS_METADATA_KEYS.has(key) ? getStatusLabel(t, value) : value;
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function isStructuredValue(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

export function getMetadataEntries(metadata: unknown): [string, unknown][] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return [];
  }
  return Object.entries(metadata as Record<string, unknown>);
}

export function getStatusTransition(
  metadata: unknown,
): { previous: string; next: string } | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const record = metadata as Record<string, unknown>;
  if (
    typeof record.previousStatus === "string" &&
    typeof record.newStatus === "string"
  ) {
    return { previous: record.previousStatus, next: record.newStatus };
  }
  return null;
}

export function formatYangonTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Yangon",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h12",
  }).format(date);
}

/** Groups already-sorted items by their calendar day in Yangon time. */
export function groupByDay<T extends { createdAt: Date }>(
  items: T[],
): { key: string; items: T[] }[] {
  const groups: { key: string; items: T[] }[] = [];
  for (const item of items) {
    const key = formatYangonDateTime(item.createdAt, "date");
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(item);
    } else {
      groups.push({ key, items: [item] });
    }
  }
  return groups;
}

export function fillTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}
