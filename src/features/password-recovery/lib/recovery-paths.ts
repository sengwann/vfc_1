/*
 * Where the recovery screens live. No imports, so server and client code and
 * tests can all use it.
 */

export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const RESET_PASSWORD_PATH = "/reset-password";
export const CHIEF_RECOVERY_PATH = "/village/password-recovery";
export const ADMIN_RECOVERY_PATH = "/admin/password-recovery";

export const RECOVERY_ERROR_PARAM = "error";
export const RECOVERY_NOTICE_PARAM = "notice";

/** Shown on the sign-in page after a successful reset (?reset=1). */
export const RESET_DONE_PARAM = "reset";
