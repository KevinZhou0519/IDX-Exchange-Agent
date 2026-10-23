import { defineConfig } from "vitest/config";

// Database integration tests against the local MySQL (corepack pnpm test:db).
export default defineConfig({
  test: {
    include: ["packages/**/*.integration.test.ts"],
  },
});
