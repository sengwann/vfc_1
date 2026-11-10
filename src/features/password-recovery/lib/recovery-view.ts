/*
 * Presentation helpers for the recovery screens. No data access and no runtime
 * imports other than the shared template helper, so server and client
 * components and unit tests can use it.
 */

import type { TranslationKey } from "../../../lib/i18n/en";
import { fillTemplate, type Translate } from "../../village-deactivation/lib/deactivation-view";

export { fillTemplate };
export type { Translate };

const NOTIFICATION_KEYS: Record<
  string,
  { title: TranslationKey; body: TranslationKey }
> = {
  RECOVERY_REQUESTED: {
    title: "recovery.notif.requested.title",
    body: "recovery.notif.requested.body",
  },
  RECOVERY_REJECTED: {
    title: "recovery.notif.rejected.title",
    body: "recovery.notif.rejected.body",
  },
  RECOVERY_PASSWORD_CHANGED: {
    title: "recovery.notif.changed.title",
    body: "recovery.notif.changed.body",
  },
  RECOVERY_RESET_COMPLETED: {
    title: "recovery.notif.completed.title",
    body: "recovery.notif.completed.body",
  },
};

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}

function formatIso(
  value: unknown,
  formatDateTime: (date: Date) => string,
): string {
  const date = typeof value === "string" ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? formatDateTime(date) : "—";
}

function roleLabel(t: Translate, role: unknown): string {
  if (role === "CHIEF") return t("shell.role.chief");
  if (role === "SYSTEM_ADMIN") return t("shell.role.systemAdmin");
  return "";
}

/**
 * Renders a stored recovery notification in the reader's language. Stored
 * params are untrusted text: only ever substituted into a template. Unknown
 * types give null.
 */
export function describeRecoveryNotification(
  t: Translate,
  type: string,
  params: unknown,
  formatDateTime: (date: Date) => string,
): { title: string; body: string } | null {
  const keys = NOTIFICATION_KEYS[type];

  if (!keys) {
    return null;
  }

  const p =
    params && typeof params === "object" && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};

  const issuer = text(p.issuedByName);
  const rejecter = text(p.rejectedByName);

  let body = fillTemplate(t(keys.body), {
    name: text(p.targetName),
    expires: formatIso(p.requestExpiresAt, formatDateTime),
    date: formatIso(p.completedAt ?? p.rejectedAt, formatDateTime),
    by: type === "RECOVERY_REJECTED" ? rejecter : issuer,
    role: roleLabel(t, type === "RECOVERY_REJECTED" ? p.rejectedByRole : p.issuedByRole),
  });

  const note = text(p.rejectionNote);

  if (type === "RECOVERY_REJECTED" && note) {
    body = `${body} ${fillTemplate(t("recovery.notif.noteLabel"), { note })}`;
  }

  return { title: t(keys.title), body };
}

/* ------------------------------------------------------------ approver page */

export const RECOVERY_STATUS_KEYS: Record<string, TranslationKey> = {
  PENDING: "recovery.status.pending",
  CODE_ISSUED: "recovery.status.codeIssued",
  COMPLETED: "recovery.status.completed",
  REJECTED: "recovery.status.rejected",
  EXPIRED: "recovery.status.expired",
  REVOKED: "recovery.status.revoked",
};

export const RECOVERY_STATUS_TONES: Record<
  string,
  "warning" | "info" | "success" | "danger" | "neutral"
> = {
  PENDING: "warning",
  CODE_ISSUED: "info",
  COMPLETED: "success",
  REJECTED: "danger",
  EXPIRED: "neutral",
  REVOKED: "neutral",
};

const FEEDBACK_ERROR_KEYS: Record<string, TranslationKey> = {
  invalid_request: "recovery.err.invalid_request",
  note_required: "recovery.err.note_required",
  note_too_long: "recovery.err.note_too_long",
  note_invalid: "recovery.err.note_invalid",
  not_found: "recovery.err.not_found",
  expired: "recovery.err.expired",
  wrong_state: "recovery.err.wrong_state",
  busy: "recovery.err.busy",
};

const FEEDBACK_NOTICE_KEYS: Record<string, TranslationKey> = {
  rejected: "recovery.notice.rejected",
  withdrawn: "recovery.notice.withdrawn",
};

/** Text for the ?error= / ?notice= codes. Unknown codes show nothing, never raw query text. */
export function resolveRecoveryFeedback(
  t: Translate,
  params: { error: string | null; notice: string | null },
): { tone: "danger" | "success"; message: string } | null {
  if (params.error) {
    const key = FEEDBACK_ERROR_KEYS[params.error];
    return key ? { tone: "danger", message: t(key) } : null;
  }

  if (params.notice) {
    const key = FEEDBACK_NOTICE_KEYS[params.notice];
    return key ? { tone: "success", message: t(key) } : null;
  }

  return null;
}
