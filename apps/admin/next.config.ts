import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const ENV_LINE = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/;
const QUOTES = /^["']|["']$/g;

// Same `--env-file-if-exists` semantics as apps/web/next.config.ts: the root .env.local, never
// overriding a variable the real environment already set.
function loadRootEnv(): void {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = ENV_LINE.exec(line);
    const key = m?.[1];
    if (key === undefined) continue;
    if (process.env[key] !== undefined) continue;
    process.env[key] = (m?.[2] ?? "").replace(QUOTES, "");
  }
}
loadRootEnv();

const nextConfig: NextConfig = {
  output: "standalone",
  // Same rule as apps/web: an optional dist dir so a second instance can run beside a live one.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  trailingSlash: false,
  poweredByHeader: false,
  reactStrictMode: true,
  images: { unoptimized: true },
  agentRules: false,
  // NEXT_PUBLIC_SITE_ORIGIN: media (/media/…) is served by the storefront, so admin thumbnails need an absolute src (CSP img-src allows it).
  env: { NEXT_PUBLIC_BUILD_ID: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev", NEXT_PUBLIC_SITE_ORIGIN: process.env.SITE_ORIGIN ?? "" },
  async headers() {
    // the spec: the panel is never indexed and never framed; the per-request CSP is proxy.ts's.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
