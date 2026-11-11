import "server-only";

import { cookies } from "next/headers";
import { SignJWT } from "jose";
import { UserRole, VillageStatus } from "@prisma/client";

import { prisma } from "../prisma";
import {
  AUTH_COOKIE_NAME,
  AUTH_SESSION_MAX_AGE_SECONDS,
} from "./auth.constants";
import { getSessionIdentity } from "./session-identity";
import type { SessionUser } from "./auth.types";

export { getSessionIdentity } from "./session-identity";

const SESSION_JWT_ALGORITHM = "HS256";

function getSessionSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required.");
  if (secret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionVersion: true },
  });

  if (!user) {
    throw new Error("Cannot create a session for an unknown user.");
  }

  const token = await new SignJWT({ sessionVersion: user.sessionVersion })
    .setProtectedHeader({ alg: SESSION_JWT_ALGORITHM })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(
      Math.floor(Date.now() / 1000) + AUTH_SESSION_MAX_AGE_SECONDS,
    )
    .sign(getSessionSecretKey());

  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
  });
}

export async function revokeUserSessions(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const identity = await getSessionIdentity();
  if (!identity) return null;

  const user = await prisma.user.findUnique({
    where: { id: identity.userId },
    select: {
      id: true,
      name: true,
      role: true,
      villageId: true,
      houseId: true,
      membershipStatus: true,
      sessionVersion: true,
      dateOfBirth: true,
      email: true,
      phone: true,
      mustChangePassword: true,
      village: { select: { status: true } },
    },
  });

  if (!user || user.sessionVersion !== identity.sessionVersion) return null;

  if (user.role !== UserRole.SYSTEM_ADMIN) {
    if (!user.villageId || !user.village) return null;
    if (user.village.status !== VillageStatus.ACTIVE) return null;
  }

  return {
    id: user.id,
    name: user.name,
    role: user.role,
    villageId: user.villageId,
    houseId: user.houseId,
    membershipStatus: user.membershipStatus,
    email: user.email,
    phone: user.phone,
    dateOfBirth: user.dateOfBirth,
    mustChangePassword: user.mustChangePassword,
  };
}
