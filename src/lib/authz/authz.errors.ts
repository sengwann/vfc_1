import "server-only";

import { redirect } from "next/navigation";

import type { AuthzErrorCode } from "./authz.types";

export const AUTHZ_FORBIDDEN_ROUTE = "/forbidden";

export const AUTHZ_GENERIC_FORBIDDEN_MESSAGE =
  "You do not have permission to access this.";

export const AUTHZ_GENERIC_NOT_FOUND_MESSAGE =
  "The requested resource was not found.";

export class AuthorizationError extends Error {
  code: AuthzErrorCode;

  constructor(
    code: AuthzErrorCode,
    message: string = AUTHZ_GENERIC_FORBIDDEN_MESSAGE,
  ) {
    super(message);
    this.code = code;
    this.name = "AuthorizationError";
  }
}

export function redirectForbidden(): never {
  redirect(AUTHZ_FORBIDDEN_ROUTE);
}
