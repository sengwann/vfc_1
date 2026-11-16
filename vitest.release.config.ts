/** Release-only config: never load application .env files. No production changes. */
import { mergeConfig, defineConfig } from "vitest/config";
import base from "./vitest.config";
export default mergeConfig(base, defineConfig({
  envDir: false,
  test: {
    // Owning hooks await uncancellable work even after an individual test fails.
    hookTimeout: 0,
    testTimeout: 0,
    setupFiles: ["./src/test-support/phase7-release-lifecycle.ts"],
  },
}));
