import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      LOG_LEVEL: process.env.LOG_LEVEL ?? "silent",
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: "2626",
      DATABASE_URL: "postgres://unused@localhost/unused",
    },
  },
});
