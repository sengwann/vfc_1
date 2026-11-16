/** Promise ownership only. No database, adapter, application or network imports.
 * Symbol.for preserves one registry even if a test resets the module cache.
 */
const key = Symbol.for("vfc.phase7.release.lifecycle.registry");
type Registry = { active: Set<Promise<unknown>> };
const globals = globalThis as typeof globalThis & { [key]: Registry | undefined };
const state = globals[key] ??= { active: new Set<Promise<unknown>>() };

/** Register before invoking work, including synchronous throws and provisioning. */
export function trackReleaseLifecycle<T>(work: () => Promise<T>): Promise<T> {
  const operation = Promise.resolve().then(work);
  state.active.add(operation);
  void operation.then(() => state.active.delete(operation), () => state.active.delete(operation));
  return operation;
}
export async function drainReleaseLifecycles(): Promise<void> {
  const failures: unknown[] = [];
  while (state.active.size) {
    const results = await Promise.allSettled([...state.active]);
    failures.push(...results.flatMap(result => result.status === "rejected" ? [result.reason] : []));
  }
  if (failures.length) throw new AggregateError(failures, "Owned lifecycle failed while draining");
}

/** Teardown waits even if a runner has already reported setup failure/timeout.
 * A resource assigned during late setup remains reachable by the cleanup closure.
 */
export async function finishReleaseSetup(setup: Promise<unknown> | undefined, cleanup: () => Promise<void>): Promise<void> {
  const failures: unknown[] = [];
  try { await setup; } catch (error) { failures.push(error); }
  try { await cleanup(); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, "Release setup/cleanup failed");
}
