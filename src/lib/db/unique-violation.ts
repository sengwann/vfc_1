/*
 * Works out which user identifier a Prisma unique-constraint error is about.
 * Pure (no imports) so it can be unit tested.
 *
 * Why not just search the whole error message: a failed create() echoes its
 * arguments, which name every column (email AND phone), so a plain search can
 * never tell the two apart. Only the final "Unique constraint failed ..."
 * sentence and the error's `meta` object are inspected.
 *
 * The constraints involved are "User_villageId_email_key",
 * "User_villageId_phone_key" and the partial "User_admin_email_key" /
 * "User_admin_phone_key"; every one of them names its column.
 */

export type UserIdentifierField = "email" | "phone";

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function getViolationText(error: unknown): string {
  const parts: string[] = [];

  if (error instanceof Error) {
    const message = error.message;
    const marker = message
      .toLowerCase()
      .lastIndexOf("unique constraint failed");

    if (marker >= 0) {
      parts.push(message.slice(marker));
    }
  }

  const meta = (error as { meta?: unknown } | null)?.meta;

  if (meta !== undefined) {
    try {
      parts.push(JSON.stringify(meta));
    } catch {
      // A meta value that cannot be serialized is ignored.
    }
  }

  return parts.join(" ").toLowerCase();
}

/**
 * Returns "email" or "phone" when the error clearly names exactly one of them,
 * otherwise null (callers then show a generic "details already exist").
 */
export function getUserIdentifierViolation(
  error: unknown,
): UserIdentifierField | null {
  if (!isUniqueViolation(error)) {
    return null;
  }

  const text = getViolationText(error);
  const email = text.includes("email");
  const phone = text.includes("phone");

  if (email && !phone) return "email";
  if (phone && !email) return "phone";
  return null;
}
