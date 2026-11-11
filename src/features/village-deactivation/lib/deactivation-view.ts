/*
 * Presentation helpers for the deactivation pages. No data access and no
 * runtime imports, so server and client components and unit tests can use them.
 * Only display: whether a cancel is really allowed is decided again by the
 * database in the transition.
 */

import type { TranslationKey } from "../../../lib/i18n/en";

export type Translate = (key: TranslationKey) => string;

export function fillTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  // One pass over the template, so a substituted value is never scanned again
  // for placeholders (stored text such as a village name stays literal).
  return template.replace(/\{([a-zA-Z]+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : match,
  );
}

export interface Countdown {
  overdue: boolean;
  remainingMs: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Time left until the stored deadline. At or after the deadline it is overdue. */
export function computeCountdown(now: Date, deadline: Date): Countdown {
  const remainingMs = Math.max(0, deadline.getTime() - now.getTime());
  const totalSeconds = Math.floor(remainingMs / 1000);

  return {
    overdue: now.getTime() >= deadline.getTime(),
    remainingMs,
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** "05:03:09". Hours may exceed 24 only if the deadline is further out than the rules allow. */
export function formatCountdown(countdown: Countdown): string {
  return `${pad(countdown.hours)}:${pad(countdown.minutes)}:${pad(countdown.seconds)}`;
}

/** The Chief may be shown the cancel form only while the deadline has not been reached. */
export function showCancelForm(now: Date, deadline: Date): boolean {
  return now.getTime() < deadline.getTime();
}

export const STATUS_LABEL_KEYS: Record<string, TranslationKey> = {
  PENDING: "deact.status.pending",
  APPROVED: "deact.status.approved",
  REJECTED: "deact.status.rejected",
  CANCELLED: "deact.status.cancelled",
  COMPLETED: "deact.status.completed",
};

export const ERROR_KEYS: Record<string, TranslationKey> = {
  invalid_request: "deact.err.invalid_request",
  reason_required: "deact.err.reason_required",
  reason_too_long: "deact.err.reason_too_long",
  confirmation_required: "deact.err.confirmation_required",
  active_fund_exists: "deact.err.active_fund_exists",
  village_not_active: "deact.err.village_not_active",
  unresolved_request_exists: "deact.err.unresolved_request_exists",
  cooldown_active: "deact.err.cooldown_active",
  not_pending: "deact.err.not_pending",
  not_approved: "deact.err.not_approved",
  deadline_reached: "deact.err.deadline_reached",
  busy: "deact.err.busy",
};

export const NOTICE_KEYS: Record<string, TranslationKey> = {
  submitted: "deact.notice.submitted",
  approved: "deact.notice.approved",
  rejected: "deact.notice.rejected",
  cancelled: "deact.notice.cancelled",
};

/**
 * Text for the ?error=/?notice=/?until= codes the actions redirect with.
 * Unknown codes give null (nothing is shown), never raw query text.
 */
export function resolveFeedback(
  t: Translate,
  params: {
    error: string | null;
    notice: string | null;
    until: string | null;
  },
  formatDateTime: (date: Date) => string,
): { tone: "danger" | "success"; message: string } | null {
  if (params.error) {
    const key = ERROR_KEYS[params.error];

    if (!key) {
      return null;
    }

    if (params.error === "cooldown_active") {
      const until = params.until ? new Date(params.until) : null;

      return {
        tone: "danger",
        message:
          until && !Number.isNaN(until.getTime())
            ? fillTemplate(t(key), { date: formatDateTime(until) })
            : t("deact.err.cooldown_active_generic"),
      };
    }

    return { tone: "danger", message: t(key) };
  }

  if (params.notice) {
    const key = NOTICE_KEYS[params.notice];
    return key ? { tone: "success", message: t(key) } : null;
  }

  return null;
}

export function formatDuration(t: Translate, minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    return fillTemplate(t("deact.duration.hours"), { n: minutes / 60 });
  }

  return fillTemplate(t("deact.duration.minutes"), { n: minutes });
}

const NOTIFICATION_KEYS: Record<
  string,
  { title: TranslationKey; body: TranslationKey }
> = {
  DEACTIVATION_REQUESTED: {
    title: "deact.notif.requested.title",
    body: "deact.notif.requested.body",
  },
  DEACTIVATION_APPROVED: {
    title: "deact.notif.approved.title",
    body: "deact.notif.approved.body",
  },
  DEACTIVATION_REJECTED: {
    title: "deact.notif.rejected.title",
    body: "deact.notif.rejected.body",
  },
  DEACTIVATION_CANCELLED: {
    title: "deact.notif.cancelled.title",
    body: "deact.notif.cancelled.body",
  },
  DEACTIVATION_COMPLETED: {
    title: "deact.notif.completed.title",
    body: "deact.notif.completed.body",
  },
  DEACTIVATION_REMINDER: {
    title: "deact.notif.reminder.title",
    body: "deact.notif.reminder.body",
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

/**
 * Renders a stored notification (type plus params) in the reader's language.
 * Stored params are untrusted text: they are only ever substituted into a
 * template and shown as text. Unknown types give null and are not listed.
 */
export function describeNotification(
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

  const offsetMinutes = Number(p.offsetMinutes);

  return {
    title: t(keys.title),
    body: fillTemplate(t(keys.body), {
      village: text(p.villageName),
      code: text(p.villageCode),
      reason:
        text(p.reason) ||
        text(p.rejectionReason) ||
        text(p.cancellationReason),
      deadline: formatIso(p.scheduledDeactivationAt, formatDateTime),
      cooldown: formatIso(p.cooldownEndsAt, formatDateTime),
      completedAt: formatIso(p.completedAt, formatDateTime),
      duration: Number.isFinite(offsetMinutes)
        ? formatDuration(t, offsetMinutes)
        : "",
    }),
  };
}
