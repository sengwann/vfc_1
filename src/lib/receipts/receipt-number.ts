import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * Generates a sequential receipt number:
 *
 * VFC-YYYYMMDD-XXXX
 *
 * Example:
 * VFC-20260908-0001
 * VFC-20260908-0002
 */
export async function generateReceiptNumber(
  tx: Prisma.TransactionClient,
): Promise<string> {
  const now = new Date();

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  const datePart = `${year}${month}${day}`;
  const prefix = `VFC-${datePart}-`;

  // Acquire a transaction-level PostgreSQL advisory lock.
  // The cast prevents Prisma from trying to deserialize PostgreSQL's
  // `void` return type.
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtext(${prefix}))::text AS lock
  `;

  const countToday = await tx.receipt.count({
    where: {
      receiptNumber: {
        startsWith: prefix,
      },
    },
  });

  const sequenceNumber = String(countToday + 1).padStart(4, "0");

  return `${prefix}${sequenceNumber}`;
}
