import { defineConfig, devices } from "@playwright/test";

/** Separate ports, so this can run while `pnpm dev` is running. */
const offset = Number(process.env.E2E_PORT_OFFSET ?? 0); // So two checkouts can run these at once.
export const API_PORT = 3210 + offset;
export const APP_PORT = 5190 + offset;
export const ADMIN_PORT = 5191 + offset;
export const PROLIFIC_PORT = 3211 + offset;
/** Run with this set to test what production serves: built apps, and the API in production mode. */
export const TEST_BUILT_APPS = process.env.E2E_BUILT === "1";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  timeout: 120_000,
  // One participant moves through the study in order, so these can't run at the same time.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "phone", use: { ...devices["iPhone 13"], browserName: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],
});
