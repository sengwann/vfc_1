import { inspectDatabaseError } from "./database-errors";

/**
 * True only for confirmed serialization/deadlock transaction aborts.
 *
 * Prisma 6 → P2034.
 * Prisma 7 + @prisma/adapter-pg at COMMIT → DriverAdapterError with
 *   cause.kind = "TransactionWriteConflict" (no code).
 * Raw SQL → P2010 with meta.driverAdapterError.
 * Raw pg → 40001 / 40P01, including known nested cause/originalCode fields.
 * Messages and ambiguous connection failures are never retry signals.
 */
export function isSerializationConflict(error: unknown): boolean {
  return inspectDatabaseError(error).retryable;
}
