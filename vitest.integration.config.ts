import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig } from "vitest/config";

if (existsSync(".env")) {
  loadEnvFile(".env");
}

/** Tests named *.itest.ts need real services, so they run separately from the fast unit tests. */
export default defineConfig({
  test: {
    include: ["apps/*/src/**/*.itest.ts", "packages/*/src/**/*.itest.ts"],
    // Real services can be slow the first time they're used, especially on CI's small machines.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
