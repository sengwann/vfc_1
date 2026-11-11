import "server-only";

import { isSerializationConflict } from "./retry";

export { isSerializationConflict } from "./retry";

/**
 * Wrap the entire interactive $transaction call, never a statement in an
 * existing transaction. No redirects, notifications or other external effects
 * belong in operation. This helper does not choose an isolation level.
 */
export async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  retries = 3,
): Promise<T> {
  if (!Number.isInteger(retries) || retries < 0) {
    throw new RangeError("retries must be a nonnegative integer");
  }
  const retryLimit = Math.min(retries, 3);
  for (let attempt = 0; ; attempt += 1) {
    try {
      // Return the OUTER $transaction promise, including COMMIT.
      return await operation();
    } catch (error) {
      if (!isSerializationConflict(error) || attempt >= retryLimit) throw error;
      const delayMs = Math.min(250, 50 * 2 ** attempt + Math.random() * 50);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
