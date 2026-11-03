import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a production build. Requires a migrated and seeded database
 * (`pnpm db:migrate && pnpm db:seed`) and `pnpm --filter @nexus/web build`. The chat tests use
 * the mock Claude API in e2e/mock-anthropic.mjs, so no real API key is needed.
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
  // Full stack: mock Claude API, worker and web app. Needs ANTHROPIC_API_KEY (any value) and
  // ANTHROPIC_BASE_URL=http://localhost:4010 in the environment of worker and web.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "node e2e/mock-anthropic.mjs",
          url: "http://localhost:4010/health",
          reuseExistingServer: !process.env.CI,
        },
        {
          command: "pnpm --filter @nexus/worker start",
          url: "http://localhost:3001/health",
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
        {
          command: "pnpm start",
          url: "http://localhost:3000/api/health",
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      ],
});
