import type { Prisma } from "@prisma/client";

export const PASSWORD_REPLACED_REASON = "PASSWORD_REPLACED";

/**
 * Acquire user locks before changing recovery requests. NO KEY UPDATE conflicts
 * with credential writes and other target transitions but permits FK checks.
 * If a transition also needs an approver lock, acquire both users in ID order
 * before taking any request lock.
 */
export async function lockRecoveryTarget(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM public."User" WHERE id = ${userId} FOR NO KEY UPDATE
  `;
  return rows.length === 1;
}

/**
 * Call in the credential update transaction, after the User write acquired its
 * row lock. At Read Committed this separate statement sees a request filed by
 * a transaction that held that lock before the credential update.
 */
export async function revokeRecoveryAfterPasswordReplacement(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<string | null> {
  const [revoked] = await tx.passwordRecoveryRequest.updateManyAndReturn({
    where: { userId, status: { in: ["PENDING", "CODE_ISSUED"] } },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
      revocationReason: PASSWORD_REPLACED_REASON,
      codeHash: null,
    },
    select: { id: true },
  });
  return revoked?.id ?? null;
}
