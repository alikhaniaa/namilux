import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { HTML_LIMITED_BOT_UA_RE_STRING } from "next/dist/shared/lib/router/utils/is-bot";
import { IMMUTABLE, NO_STORE, securityHeaders } from "./src/security/headers";
const ENV_LINE = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/;
const QUOTES = /^["']|["']$/g;
/**
 * DECISION: Next reads `.env*` from the app directory, but the spec makes the ROOT `.env.example`
 * the single documented list, and dev keeps one `.env.local` at the root for all three apps. This is
 * `--env-file-if-exists` semantics done in config (which Next evaluates before anything reads env):
 * only when the file exists, and never overwriting a variable the real environment already set - so
 * staging and production, which inject env properly, are untouched.
 */
function loadRootEnv(): void {
    const file = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env.local");
    if (!existsSync(file))
        return;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = ENV_LINE.exec(line);
        const key = m?.[1];
        if (key === undefined)
            continue;
        if (process.env[key] !== undefined)
            continue;
        process.env[key] = (m?.[2] ?? "").replace(QUOTES, "");
    }
}
loadRootEnv();
// Bound framework cache memory independently of the process heap.
const DEFAULT_CACHE_MAX_MB = 128;
function cacheMaxMb(): number {
    const raw = process.env.NEXT_CACHE_MAX_MB;
    if (raw === undefined)
        return DEFAULT_CACHE_MAX_MB;
    const mb = Number(raw.trim());
    return Number.isSafeInteger(mb) && mb > 0 ? mb : DEFAULT_CACHE_MAX_MB;
}
// `upgrade-insecure-requests` must not fire on a local http origin (headers.ts rules).
const https = (process.env.SITE_ORIGIN ?? "https://namilux.ir").startsWith("https:");
const nextConfig: NextConfig = {
    output: "standalone",
    // DECISION (2 Sep): a second dev/build instance beside a running one needs its own dist dir (Next 16
    // holds a per-distDir dev lock). Unset in every documented flow, so `.next` stays the default.
    distDir: process.env.NEXT_DIST_DIR ?? ".next",
    trailingSlash: true,
    poweredByHeader: false,
    reactStrictMode: true,
    cacheComponents: true,
    // DECISION: Next 16.3.3 removed `experimental.viewTransition` - View Transitions now need no flag
    // (the spec is satisfied by `<ViewTransition>` from React plus the ::view-transition rules in
    // styles/components.css).
    images: { unoptimized: true },
    /**
     * DECISION (4 Sep 2026, performance review): `htmlLimitedBots` is Next's *bot* list, and it does
     * more than switch metadata streaming off. `isBot(ua)` also disables the dynamic response path,
     * so every request it matches is rendered blocking from scratch - the prerendered static shell
     * and the ISR entry are bypassed and the response is `Cache-Control: private, no-store`.
     * With the previous `/.*\/` every phone was a "bot": a fully static home cost ~50–150 ms of CPU
     * per hit instead of a file read, and no CDN could cache any catalogue page.
     *
     * Now the list is Next's default (Google, Bing, Yandex, the Facebook/Instagram, WhatsApp,
     * Telegram, Twitter and Slack link-preview fetchers, …) plus the repo's own crawlers, which read
     * `<head>` with anchored regexes and no DOM. Those clients still get the blocking
     * render with every head tag in place. Browsers get the static shell; on a cached page the head
     * is already complete in the prerendered HTML, and on the first-ever hit of an ISR fallback
     * React hoists the streamed metadata into <head> before paint.
     */
    htmlLimitedBots: new RegExp(`${HTML_LIMITED_BOT_UA_RE_STRING}|namilux-contract-check|namilux-seo-crawl`, "i"),
    // This sizes separate framework caches, not total process memory. Next embeds it in the
    // standalone build: changing NEXT_CACHE_MAX_MB requires a rebuild, not just a restart.
    cacheMaxMemorySize: cacheMaxMb() * 1024 * 1024,
    // The build prerenders ~600 catalogue paths against the local database (generateStaticParams);
    // a transient connection error must retry the page, not fail the release.
    experimental: { staticGenerationRetryCount: 3 },
    // The scaffold's own the spec is the guardrail file; Next must not write per-app agent rules
    // beside it (they would be auto-loaded and could contradict it).
    agentRules: false,
    env: { NEXT_PUBLIC_BUILD_ID: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" },
    /**
     * DECISION (4 Sep 2026): the legacy sitemap children keep their root URLs for Google
     * and are served by app/sitemaps/[name]. This used to be a middleware
     * `NextResponse.rewrite(absoluteUrl)`; behind Caddy - forwarded https, loopback hostname - Next
     * treated that URL as a different origin and proxied it to https://localhost:3000, which has no
     * TLS, so every child answered 500 on the server (never locally). A config rewrite is always
     * internal. The route still checks the name against SITEMAP_NAMES and 404s anything else.
     */
    async rewrites() {
        return [{ source: "/:name([a-z_]+-sitemap\\d*).xml", destination: "/sitemaps/:name.xml" }];
    },
    async headers() {
        return [
            { source: "/:path*", headers: securityHeaders("cached", undefined, https) },

            { source: "/media/:path*", headers: IMMUTABLE },
            { source: "/fonts/:path*", headers: IMMUTABLE },
            { source: "/icons/:path*", headers: IMMUTABLE },
            { source: "/splash/:path*", headers: IMMUTABLE },
            { source: "/screenshots/:path*", headers: IMMUTABLE },
            // the spec: the SW itself is never cached at the edge, and it may claim the root scope.
            {
                source: "/sw.js",
                headers: [
                    { key: "Cache-Control", value: "no-cache, must-revalidate" },
                    { key: "Service-Worker-Allowed", value: "/" },
                ],
            },
            { source: "/sw-kill.js", headers: [{ key: "Cache-Control", value: "no-cache, must-revalidate" }] },
            { source: "/manifest.webmanifest", headers: [{ key: "Cache-Control", value: "public, max-age=3600" }] },
            // the spec: no personal or transactional response is ever stored anywhere.
            { source: "/api/:path*", headers: NO_STORE },
            { source: "/account/:path*", headers: NO_STORE },
            { source: "/billing/:path*", headers: NO_STORE },
        ];
    },
};
export default nextConfig;
