import { configDefaults, defineConfig } from "vitest/config";

// Unit tests only. Database tests (*.integration.test.ts) need a running MySQL
// and run with `corepack pnpm test:db`.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "**/*.integration.test.ts"],
  },
});
