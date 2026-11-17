import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * `import "server-only"` throws unless the resolver picks the package's `react-server` entry - the
 * empty one Next uses on the server. Vitest externalizes the package to node, which never sees that
 * condition, so the empty file is aliased in directly. Every server module in this app carries the
 * marker, so it is answered once here rather than worked around in each test.
 */
const serverOnlyEmpty = createRequire(import.meta.url)
  .resolve("server-only")
  .replace(/index\.js$/, "empty.js");

/**
 * Load the repo-root `.env*` the way `packages/{db,core}/vitest.config.ts` do. Since M2 the handler
 * pipeline reaches `lib/session.ts → lib/db.ts`, which constructs the per-role pool at import time
 * and needs `DATABASE_URL_WEB`; without it every handler test fails at import. Only DATABASE_URL_* /
 * APP_ENV / NODE_ENV are passed through (identical reader to the sibling packages).
 */
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function loadEnvFiles(dir: string, files: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of files) {
    const path = `${dir}${file}`;
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (line === "" || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (value.length >= 2 && (value.startsWith('"') || value.startsWith("'")) && value.endsWith(value[0] ?? "")) {
        value = value.slice(1, -1);
      }
      out[key] = value;
    }
  }
  return out;
}

const fileEnv = loadEnvFiles(repoRoot, [".env", ".env.local"]);
const allowedEnv: Record<string, string> = Object.fromEntries(
  Object.entries(fileEnv).filter(([k]) => k.startsWith("DATABASE_URL_") || k === "APP_ENV" || k === "NODE_ENV"),
);

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      // The `@/*` alias of tsconfig.json, repeated because vitest resolves modules itself.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": serverOnlyEmpty,
    },
  },
  // testTimeout 30 s like the sibling packages: the first handler test pays the cold import of the
  // core barrel + the pool, which exceeds the 5 s default under `pnpm check` load.
  test: { include: ["src/**/*.test.ts", "src/**/*.test.tsx"], environment: "node", env: Object.fromEntries(Object.entries(allowedEnv).map(([k, v]) => [k, process.env[k] ?? v])), fileParallelism: false, testTimeout: 30_000 },
});
