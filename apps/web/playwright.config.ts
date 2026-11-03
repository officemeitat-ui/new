import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a production build. Requires a migrated and seeded database
 * (`pnpm db:migrate && pnpm db:seed`) and `pnpm --filter @nexus/web build`.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "de-AT",
    timezoneId: "Europe/Vienna",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm start",
        url: "http://localhost:3000/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
