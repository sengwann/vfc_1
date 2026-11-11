/*
 * Pure parsing of the deactivation workflow settings from an environment-like
 * object. No imports and no process.env access here, so it can be unit tested
 * directly; callers pass process.env.
 *
 * A wrong value throws instead of falling back. Silently using a shorter
 * cooldown or a missing reminder would change workflow behavior without anyone
 * noticing. The 24 hour countdown itself is fixed by the rules and has no
 * setting.
 */

export const DEFAULT_REJECTION_COOLDOWN_HOURS = 24;
export const DEFAULT_REMINDER_HOURS: readonly number[] = [12, 1];
export const DEFAULT_WORKER_INTERVAL_SECONDS = 60;
export const DEFAULT_WORKER_BATCH_SIZE = 25;

const HOUR_MS = 60 * 60 * 1000;
const MAX_COOLDOWN_HOURS = 24 * 30;
const MAX_REMINDER_HOURS = 24;

export const ENV_REJECTION_COOLDOWN_HOURS =
  "DEACTIVATION_REJECTION_COOLDOWN_HOURS";
export const ENV_REMINDER_HOURS = "DEACTIVATION_REMINDER_HOURS";
export const ENV_WORKER_INTERVAL_SECONDS =
  "DEACTIVATION_WORKER_INTERVAL_SECONDS";
export const ENV_WORKER_BATCH_SIZE = "DEACTIVATION_WORKER_BATCH_SIZE";

export interface DeactivationConfig {
  rejectionCooldownMs: number;
  /** Offsets before the deadline, largest first, for example [12h, 1h]. */
  reminderOffsetsMs: number[];
  workerIntervalMs: number;
  workerBatchSize: number;
}

export class DeactivationConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeactivationConfigError";
  }
}

export type DeactivationEnv = Record<string, string | undefined>;

function read(env: DeactivationEnv, name: string): string | null {
  const value = env[name];

  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? null : trimmed;
}

function parseNumber(name: string, raw: string): number {
  // Number("") is 0 and Number("1e3") is accepted, so match the shape first.
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new DeactivationConfigError(
      `${name} must be a positive number, got "${raw}".`,
    );
  }

  return Number(raw);
}

function parseInteger(
  env: DeactivationEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = read(env, name);

  if (raw === null) {
    return fallback;
  }

  if (!/^\d+$/.test(raw)) {
    throw new DeactivationConfigError(
      `${name} must be a whole number, got "${raw}".`,
    );
  }

  const value = Number(raw);

  if (value < min || value > max) {
    throw new DeactivationConfigError(
      `${name} must be between ${min} and ${max}, got ${value}.`,
    );
  }

  return value;
}

function parseCooldownHours(env: DeactivationEnv): number {
  const raw = read(env, ENV_REJECTION_COOLDOWN_HOURS);

  if (raw === null) {
    return DEFAULT_REJECTION_COOLDOWN_HOURS;
  }

  const hours = parseNumber(ENV_REJECTION_COOLDOWN_HOURS, raw);

  if (hours <= 0 || hours > MAX_COOLDOWN_HOURS) {
    throw new DeactivationConfigError(
      `${ENV_REJECTION_COOLDOWN_HOURS} must be greater than 0 and at most ${MAX_COOLDOWN_HOURS}, got ${hours}.`,
    );
  }

  return hours;
}

function parseReminderHours(env: DeactivationEnv): number[] {
  const raw = read(env, ENV_REMINDER_HOURS);

  if (raw === null) {
    return [...DEFAULT_REMINDER_HOURS];
  }

  const hours = raw.split(",").map((part) => {
    const trimmed = part.trim();

    if (trimmed.length === 0) {
      throw new DeactivationConfigError(
        `${ENV_REMINDER_HOURS} has an empty entry: "${raw}".`,
      );
    }

    const value = parseNumber(ENV_REMINDER_HOURS, trimmed);

    if (value <= 0 || value >= MAX_REMINDER_HOURS) {
      // A reminder at or beyond the 24h countdown would fire at approval or
      // never; it is a mistake rather than a useful setting.
      throw new DeactivationConfigError(
        `${ENV_REMINDER_HOURS} entries must be greater than 0 and less than ${MAX_REMINDER_HOURS}, got ${value}.`,
      );
    }

    return value;
  });

  return Array.from(new Set(hours)).sort((a, b) => b - a);
}

export function parseDeactivationConfig(
  env: DeactivationEnv,
): DeactivationConfig {
  return {
    rejectionCooldownMs: Math.round(parseCooldownHours(env) * HOUR_MS),
    reminderOffsetsMs: parseReminderHours(env).map((hours) =>
      Math.round(hours * HOUR_MS),
    ),
    workerIntervalMs:
      parseInteger(
        env,
        ENV_WORKER_INTERVAL_SECONDS,
        DEFAULT_WORKER_INTERVAL_SECONDS,
        5,
        3600,
      ) * 1000,
    workerBatchSize: parseInteger(
      env,
      ENV_WORKER_BATCH_SIZE,
      DEFAULT_WORKER_BATCH_SIZE,
      1,
      200,
    ),
  };
}
