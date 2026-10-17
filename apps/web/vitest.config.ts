import { defineConfig } from "vitest/config";

// Unit tests only. The Playwright specs in e2e/ run with `pnpm e2e`.
export default defineConfig({
  test: {
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
    passWithNoTests: true,
  },
});
