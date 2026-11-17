import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

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
const allowed: Record<string, string> = Object.fromEntries(
  Object.entries(fileEnv).filter(([k]) => k.startsWith("DATABASE_URL_") || k === "APP_ENV" || k === "NODE_ENV"),
);

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
    globals: false,
    passWithNoTests: false,
    env: Object.fromEntries(Object.entries(allowed).map(([k, v]) => [k, process.env[k] ?? v])),
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
