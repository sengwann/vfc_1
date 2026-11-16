/** Release config only. A timed-out case cannot hand live fixture work to the
 * next case; hooks remain active until all owned operations settle. */
import { beforeEach, afterEach, afterAll } from "vitest";
import { drainReleaseLifecycles } from "./phase7-release-registry";
beforeEach(drainReleaseLifecycles, 0);
afterEach(drainReleaseLifecycles, 0);
afterAll(drainReleaseLifecycles, 0);
