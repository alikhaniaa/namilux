import "server-only";
import { effectiveFlags, getLegacyHead, getSettings } from "@namilux/core";
import type { EffectiveFlags, LegacyHead, Settings } from "@namilux/core";
import { tagSettings } from "@/lib/cache";
import { db } from "@/lib/db";
import { env } from "@/env";
// The `"use cache"` directive lives here rather than in a wrapper: Next 16 cannot take a callback
// across the cache boundary (see the DEVIATION note in lib/cache.ts). `tagSettings()` applies the
// family tag and the "minutes" lifetime to this scope.
export async function loadSettings(): Promise<Settings> {
    "use cache";
    tagSettings();
    return getSettings(db);
}
export async function loadFlags(): Promise<EffectiveFlags> {
    // Not cached: the env half of the pair is the emergency override and must take
    // effect on the next request, not after a cache window.
    return effectiveFlags(await loadSettings(), env);
}
/**
 * The verbatim legacy `<head>` of a route that is not an entity - `/`, `/blog/`, `/cart/`,
 * `/compare/`, `/wishlist/`, `/my-account/` and the two legacy oddities. the spec wants those
 * titles reproduced byte for byte, and `seo_snapshots` is the only place the seed could put them
 * (see the WHAT in core/seo/legacy-head.ts). Cached with the settings family: the baseline changes
 * only when a parity crawl writes a new run.
 */
export async function loadLegacyHead(path: string): Promise<LegacyHead | null> {
    "use cache";
    tagSettings();
    return getLegacyHead(db, path);
}
