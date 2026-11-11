import "server-only";

export const AUTH_COOKIE_NAME = "vfcs_session";

export const AUTH_SESSION_MAX_AGE_DAYS = 7;

export const AUTH_SESSION_MAX_AGE_SECONDS =
  AUTH_SESSION_MAX_AGE_DAYS * 24 * 60 * 60;

export const LOGIN_ROUTE = "/login";

export const DEFAULT_POST_LOGIN_ROUTE = "/dashboard";

/**
 * Where an account with mustChangePassword is sent. It must stay OUTSIDE the
 * (protected), (village) and (platform) route groups: their layouts require a
 * fully cleared session and would redirect back here forever.
 */
export const CHANGE_PASSWORD_ROUTE = "/change-password";

/** The single generic message for every failed sign-in (no enumeration). */
export const AUTH_INVALID_CREDENTIALS_MESSAGE = "Invalid credentials.";

/** Message returned while a sign-in is temporarily throttled. */
export const AUTH_THROTTLED_MESSAGE = "Too many sign-in attempts.";

/*
 * Login throttling. An attempt is counted before the password is checked.
 * Attempts 1..max are allowed; attempt max+1 starts the cooldown.
 */
export const LOGIN_THROTTLE_WINDOW_SECONDS = 15 * 60;

export const LOGIN_THROTTLE_COOLDOWN_SECONDS = 15 * 60;

/** Per account (or identifier) per client IP. */
export const LOGIN_THROTTLE_IDENTIFIER_MAX_ATTEMPTS = 5;

/** Per client IP across all accounts. */
export const LOGIN_THROTTLE_IP_MAX_ATTEMPTS = 30;

/** Throttle rows untouched for this long are deleted opportunistically. */
export const LOGIN_THROTTLE_RETENTION_SECONDS = 24 * 60 * 60;

/*
 * Signup throttling (village-code check and registration), per client IP.
 * Generous on purpose: a whole village may register from one shared network
 * during a single meeting.
 */
export const SIGNUP_THROTTLE_IP_MAX_ATTEMPTS = 60;
