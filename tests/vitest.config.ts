import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = fileURLToPath(new URL("./", import.meta.url));
const webSrc = fileURLToPath(new URL("../apps/web/src/", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "server-only", replacement: `${here}security/support/server-only.ts` },
      { find: "@/env", replacement: `${here}security/support/env-shim.ts` },
      { find: /^@\/(.*)$/, replacement: `${webSrc}$1` },
    ],
  },
  test: {
    include: ["contract/**/*.test.ts", "security/**/*.test.ts"],
    environment: "node",
    globals: false,
    passWithNoTests: false,
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
