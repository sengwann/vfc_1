/*
 * A minimum response time for the two public recovery actions. Filing a request
 * does more work when the account exists (writes, notifications) than when it
 * does not, and an attacker could time that difference to learn which accounts
 * exist. Holding every answer to at least `floorMs` hides it, as long as the
 * real work stays under the floor. The floor is a setting in recovery-config.ts
 * and must be tuned against the deployed app.
 *
 * The wait also happens when the work throws, so an error cannot be told apart
 * by its speed.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withResponseFloor<T>(
  floorMs: number,
  work: () => Promise<T>,
  options: {
    now?: () => number;
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<T> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? sleep;
  const startedAt = now();

  try {
    return await work();
  } finally {
    const remaining = floorMs - (now() - startedAt);

    if (remaining > 0) {
      await wait(remaining);
    }
  }
}
