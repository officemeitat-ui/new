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
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      // Tests start signed in as the seeded admin; anonymous tests reset this themselves.
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/admin.json" },
    },
  ],
  // Full stack: mock Claude API, SMTP sink, worker and web app. Needs ANTHROPIC_API_KEY (any
  // value), ANTHROPIC_BASE_URL=http://localhost:4010 and SMTP_PORT=2525 for worker and web.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "node e2e/mock-anthropic.mjs",
          url: "http://localhost:4010/health",
          reuseExistingServer: !process.env.CI,
        },
        {
          // Microsoft identity platform + Graph (Intune). Web and worker need
          // MICROSOFT_GRAPH_CLIENT_ID/SECRET (any value), MICROSOFT_LOGIN_URL=http://localhost:4020/login
          // and MICROSOFT_GRAPH_URL=http://localhost:4020/graph/v1.0.
          command: "node ../../packages/connectors/src/testing/mock-microsoft.ts",
          url: "http://localhost:4020/health",
          reuseExistingServer: !process.env.CI,
        },
        {
          // BookStack and Atera. Web and worker need ATERA_API_URL=http://localhost:4030/atera/api/v3
          // and CONNECTOR_ALLOW_PRIVATE_URLS=true (the mock runs on localhost over http).
          command: "node ../../packages/connectors/src/testing/mock-tools.ts",
          url: "http://localhost:4030/health",
          reuseExistingServer: !process.env.CI,
        },
        {
          // Receives every e-mail; web and worker need SMTP_HOST=localhost, SMTP_PORT=2525.
          command: "node e2e/smtp-sink.mjs",
          url: "http://localhost:2526/health",
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
