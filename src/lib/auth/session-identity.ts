import "server-only";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { AUTH_COOKIE_NAME } from "./auth.constants";

const SESSION_JWT_ALGORITHM = "HS256";

function getSessionSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required.");
  if (secret.length < 32) {
    throw new Error("AUTH_SECRET must be at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

/** Verified cookie claims only; consumers must recheck database restrictions. */
export async function getSessionIdentity(): Promise<{
  userId: string;
  sessionVersion: number;
} | null> {
  // Resolve the key outside the try/catch so a missing or too-short
  // AUTH_SECRET throws loudly instead of looking like "nobody is signed in".
  const secretKey = getSessionSecretKey();

  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: [SESSION_JWT_ALGORITHM],
    });
    if (!payload.sub || typeof payload.sessionVersion !== "number") {
      return null;
    }
    return {
      userId: payload.sub,
      sessionVersion: payload.sessionVersion,
    };
  } catch {
    return null;
  }
}
