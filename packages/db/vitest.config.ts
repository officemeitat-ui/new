import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.ts"],
    // Database tests share one database; run files one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    env: { LOG_LEVEL: "silent" },
  },
});
