import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/*.test.ts"],
    testTimeout: 20_000,
    // the two "real extract" suites read 550 files from data/extract in beforeAll; slow disks need more than the 10 s default
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/transform/**", "src/images/**", "src/extract/**"],
    },
  },
});
