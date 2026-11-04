import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig keeps JSX for Next.js ("preserve"); tests compile it with the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["test/**/*.test.ts"],
    env: { LOG_LEVEL: "silent" },
  },
});
