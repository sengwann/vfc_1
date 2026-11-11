"use server";

import { AuditActionType, UserRole, VillageStatus } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { verifyPassword } from "../../../lib/auth/password";
import { createSession } from "../../../lib/auth/session";
import {
  getSafeRedirectPath,
  validateLoginInput,
} from "../../../lib/auth/validators";
import {
  AUTH_INVALID_CREDENTIALS_MESSAGE,
  AUTH_THROTTLED_MESSAGE,
  CHANGE_PASSWORD_ROUTE,
} from "../../../lib/auth/auth.constants";
import { getClientIp } from "../../../lib/auth/client-ip";
import {
  clearLoginThrottle,
  maybeCleanupLoginThrottle,
  reserveLoginAttempt,
} from "../../../lib/auth/login-throttle";
import { AuditEntityType, tryCreateAuditLog } from "../../../lib/audit";
import type { LoginResult } from "../../../lib/auth/auth.types";

const DUMMY_PASSWORD_HASH =
  "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

function getFormDataString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function invalidCredentials(): LoginResult {
  return {
    success: false,
    code: "INVALID_CREDENTIALS",
    error: AUTH_INVALID_CREDENTIALS_MESSAGE,
  };
}

export async function loginAction(formData: FormData): Promise<LoginResult> {
  const input = {
    identifier: getFormDataString(formData, "identifier"),
    password: getFormDataString(formData, "password"),
    villageCode: getFormDataString(formData, "villageCode"),
    redirectTo: getFormDataString(formData, "redirectTo") || undefined,
  };

  // Malformed input costs no bcrypt work, so it is not counted.
  const validation = validateLoginInput(input);
  if (!validation.ok) {
    return invalidCredentials();
  }

  const { identifier, password, villageCode, redirectTo } = validation.data;

  const identifierWhere =
    identifier.type === "email"
      ? { email: identifier.value }
      : { phone: identifier.value };

  // Email and phone are only unique inside one village, so the account is
  // always looked up INSIDE a scope, never by identifier alone:
  //  - with a village code: that village's own users (never a SYSTEM_ADMIN);
  //  - without one: platform administrators only (SYSTEM_ADMIN, no village).
  const user = await prisma.user.findFirst({
    where: villageCode
      ? {
          ...identifierWhere,
          role: { not: UserRole.SYSTEM_ADMIN },
          village: { is: { villageCode } },
        }
      : {
          ...identifierWhere,
          role: UserRole.SYSTEM_ADMIN,
          villageId: null,
        },
    select: {
      id: true,
      passwordHash: true,
      role: true,
      villageId: true,
      mustChangePassword: true,
      village: { select: { status: true } },
    },
  });

  // Known accounts are throttled by user id, so email and phone attempts
  // against the same account share one counter. Unknown identifiers include
  // the scope, so the same address in two villages is counted separately.
  const identityKey = user
    ? `user:${user.id}`
    : `identifier:${villageCode ? `village:${villageCode}` : "admin"}:${identifier.type}:${identifier.value}`;

  const clientIp = await getClientIp();

  // Count the attempt BEFORE checking the password (atomic, race-free).
  const throttle = await reserveLoginAttempt(prisma, { identityKey, clientIp });

  for (const lockout of throttle.newLockouts) {
    const isAccountScope = lockout.scope === "IDENTIFIER_IP";
    // Skip unknown-identifier lockouts so attackers cannot flood the audit log.
    if (isAccountScope && !user) continue;

    // Best-effort; never interrupts or bypasses enforcement.
    await tryCreateAuditLog(prisma, {
      actionType: AuditActionType.LOGIN_THROTTLED,
      entityType: AuditEntityType.SESSION,
      entityId: isAccountScope ? (user?.id ?? null) : null,
      villageId: isAccountScope ? (user?.villageId ?? null) : null,
      actorUserId: null,
      metadata: {
        scope: lockout.scope,
        attemptLimit: lockout.attemptLimit,
        cooldownSeconds: lockout.cooldownSeconds,
        keyFingerprint: lockout.keyFingerprint,
      },
    });
  }

  if (throttle.blocked) {
    return {
      success: false,
      code: "THROTTLED",
      error: AUTH_THROTTLED_MESSAGE,
      retryAfterSeconds: throttle.retryAfterSeconds,
    };
  }

  const passwordIsValid = await verifyPassword(
    password,
    user?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );

  if (!user || !passwordIsValid) {
    await maybeCleanupLoginThrottle(prisma);
    return invalidCredentials();
  }

  if (user.role !== UserRole.SYSTEM_ADMIN) {
    if (!user.villageId || !user.village) {
      return invalidCredentials();
    }
    if (user.village.status !== VillageStatus.ACTIVE) {
      return invalidCredentials();
    }
  }

  await clearLoginThrottle(prisma, throttle.identifierKeyHash);

  await createSession(user.id);

  await tryCreateAuditLog(prisma, {
    actionType: AuditActionType.LOGIN,
    entityType: AuditEntityType.SESSION,
    entityId: user.id,
    villageId: user.villageId ?? null,
    actorUserId: user.id,
    metadata: { userRole: user.role, villageId: user.villageId },
  });

  return {
    success: true,
    // A Chief with an initial password goes straight to the change-password
    // page. The server guards enforce this too; this only avoids a bounce.
    redirectTo: user.mustChangePassword
      ? CHANGE_PASSWORD_ROUTE
      : getSafeRedirectPath(redirectTo),
  };
}
