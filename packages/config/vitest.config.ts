import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts", "eslint/__tests__/**/*.test.ts"],
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "eslint/rules/**/*.js"],
      reporter: ["text", "lcov"],
    },
  },
});
