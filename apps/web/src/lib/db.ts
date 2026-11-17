import "server-only";
import { getDb } from "@namilux/db";
import type { DbClient } from "@namilux/db";
import { env } from "@/env";
// getDb is a per-role singleton on globalThis, so Next dev HMR reuses one pool (packages/db client.ts).
// The URL comes from the parsed env rather than process.env so a missing value fails at startup.
export const db: DbClient = getDb("web", {
    url: env.DATABASE_URL_WEB,
    applicationName: "namilux-web",
    // Two storefront instances share one Postgres, so the second one is sized down from the driver
    // default rather than doubling the backends the box has to hold open (`DB_POOL_MAX`, unset on a
    // single-site deployment).
    poolMax: env.DB_POOL_MAX ?? (10),
    // 4 Sep 2026: `next build` prerenders the catalogue (generateStaticParams) from several worker
    // processes at once; each would otherwise open the full web pool (10) and a small Postgres resets
    // connections (ECONNRESET mid-build). Two per worker is plenty - the loaders are cached per worker.
    // Listed last so it wins over DB_POOL_MAX: a build's pool is about the build, not about serving.
    ...(process.env.NEXT_PHASE === "phase-production-build" ? { poolMax: 2 } : {}),
});
