import { ulid } from "@namilux/core/ids";
import { isEncodedCanonical, legacyMyAccountRedirect, legacyPaginationRedirect, lowerHex } from "@namilux/core/url";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { NO_STORE, csp, securityHeaders } from "@/security/headers";
import { redirectTarget, requestOrigin } from "@/lib/request-origin";
import { loadNotFoundPage, resolvableKey, resolveRouteStatus } from "@/lib/route-status";

const MAX_URL_LENGTH = 2048;
/**
 * Linux caps a file name at 255 bytes and Next names its prerender-cache directories after the
 * decoded path, so a crawler asking for a whole sentence as a slug ends in ENAMETOOLONG noise in
 * the log. The longest real segment on the site is 95 bytes. A segment that does not decode is
 * treated the same way.
 */
const MAX_SEGMENT_BYTES = 200;
function hasOversizedSegment(pathname: string): boolean {
  for (const segment of pathname.split("/")) {
    // The pathname is percent-encoded, so its decoded byte length never exceeds its length.
    if (segment.length <= MAX_SEGMENT_BYTES) continue;
    try {
      if (new TextEncoder().encode(decodeURIComponent(segment)).length > MAX_SEGMENT_BYTES) return true;
    } catch {
      return true;
    }
  }
  return false;
}
const PAGE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * the spec: `/locations.kml` answers 410. It was a store-locator plugin's KML feed; the store
 * itself lives on `/store/` now, and 410 tells a crawler the resource is deliberately gone rather
 * than temporarily missing - which a 404 does not. It is answered here so no route file has to
 * exist for a path that must never render.
 */
const GONE = new Set(["/locations.kml"]);

/** the spec: these prefixes are personal or transactional - nonce CSP, never stored. */
const DYNAMIC_PREFIXES = ["/account", "/billing", "/cart", "/compare", "/track", "/pay", "/api"] as const;

function isDynamicPath(pathname: string): boolean {
  return DYNAMIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * DECISION: `SITE_ORIGIN` / `TRUST_PROXY` are read from `process.env` rather than from `./env`
 * (which calls `webEnv()` and imports "server-only"): proxy.ts runs in the middleware runtime,
 * where "server-only" is not resolvable and a zod parse on every request is pure overhead. The
 * values are only ever compared, never trusted as input.
 */
const SITE_ORIGIN = process.env.SITE_ORIGIN ?? "https://namilux.ir";
const TRUST_PROXY = process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true";

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const url = req.nextUrl;
  const requestId = ulid();

  // 1. hygiene ---------------------------------------------------------------------------------
  if (req.url.length > MAX_URL_LENGTH) {
    return new NextResponse(null, { status: 414 });
  }
  if (hasOversizedSegment(url.pathname)) {
    return new NextResponse(null, { status: 404 });
  }
  const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
  if (!isApi && !PAGE_METHODS.has(req.method)) {
    return new NextResponse(null, { status: 405, headers: { Allow: "GET, HEAD, OPTIONS" } });
  }

  // 2–4. one combined 301: canonical origin, lowercase encoding, then the legacy shape ----------
  const canonical = new URL(SITE_ORIGIN);
  const incoming = requestOrigin(new URL(url.toString()), req.headers, TRUST_PROXY);
  const targetHost = TRUST_PROXY ? canonical.host : incoming.host;
  const targetProtocol = TRUST_PROXY ? canonical.protocol : incoming.protocol;

  // The pathname Next hands us is percent-encoded; the spec fixes lowercase hex.
  let targetPath = isEncodedCanonical(url.pathname) ? url.pathname : lowerHex(url.pathname);
  let targetSearch = url.search;

  const legacy = legacyRedirect(targetPath);
  if (legacy !== null) {
    const [legacyPath, legacySearch] = splitTarget(legacy);
    targetPath = legacyPath;
    // A legacy pagination redirect carries `?page=N`; keep the original query behind it.
    targetSearch = mergeSearch(legacySearch, targetSearch);
  }

  const changed =
    targetHost !== incoming.host ||
    targetProtocol !== incoming.protocol ||
    targetPath !== url.pathname ||
    targetSearch !== url.search;

  if (changed) {
    const to = redirectTarget(targetHost, targetProtocol, targetPath, targetSearch);
    const redirect = NextResponse.redirect(to, 301);
    redirect.headers.set("x-request-id", requestId);
    return redirect;
  }

  // 4a′. deliberately gone.
  if (GONE.has(url.pathname)) {
    const gone = new NextResponse(null, { status: 410 });
    gone.headers.set("x-request-id", requestId);
    gone.headers.set("cache-control", "public, max-age=3600");
    return gone;
  }

  // 4b. legacy sitemap children (`/product-sitemap1.xml`, …) live at the root for Google. They used to
  // be rewritten here with an absolute URL; behind Caddy (forwarded https, loopback hostname) Next
  // classified that as an external proxy to https://localhost:3000 and answered 500 (4 Sep 2026,
  // demo box). The mapping now lives in next.config.ts `rewrites()`, which is always internal.

  // 4c. the route oracle: a real 301/410 for a path the `redirects` table owns, and a real 404 for
  // one nothing serves. It has to happen HERE. Under `cacheComponents` the catalogue and content
  // segments are partially prerendered, so Next flushes their fallback shell - status line already
  // written, `x-nextjs-postponed: 1` - before the segment can look the row up; `notFound()` and
  // `permanentRedirect()` then swap the body of a response that is already a 200. Measured on r17:
  // every archived product, every retired brand and every unknown path answered 200 with the
  // Persian 404 inside it. lib/route-status.ts holds the mechanism and the cost.
  //
  // A live path is a Set lookup against the in-process snapshot and costs no I/O; the oracle only
  // ever answers `null` - "serve it as the router would" - when it cannot reach its endpoint, so a
  // failure here can never take a page down.
  const asked = resolvableKey(url.pathname);
  if (asked !== null) {
    const status = await resolveRouteStatus(asked, req.headers.get("referer"));
    if (status !== null && status.kind === "redirect") {
      if (status.code === 410) {
        const gone = new NextResponse(null, { status: 410 });
        gone.headers.set("x-request-id", requestId);
        return gone;
      }
      // The stored target is already percent-encoded and may carry its own `?page=N`.
      const [toPath, toSearch] = splitTarget(status.to);
      const redirect = NextResponse.redirect(redirectTarget(targetHost, targetProtocol, toPath, toSearch), 301);
      redirect.headers.set("x-request-id", requestId);
      return redirect;
    }
    // A hard 404 carrying the app's own Persian not-found page. The body is the app's, read once
    // over loopback (see the DECISION in lib/route-status.ts for why it is not a rewrite); the
    // status line is the point, and this is the last place it can still be written.
    //
    // Client-side navigations (`RSC`) are left alone: their answer is a flight payload, not HTML,
    // and the router already renders the not-found body for them. What has to carry a status is the
    // document request - the one a crawler makes.
    if (status !== null && status.kind === "missing" && req.headers.get("rsc") === null) {
      const html = await loadNotFoundPage();
      if (html !== null) {
        const missing = new NextResponse(html, { status: 404 });
        for (const { key, value: headerValue } of securityHeaders("cached", undefined, canonical.protocol === "https:")) {
          missing.headers.set(key, headerValue);
        }
        // Never stored: the admin can turn the row behind this path into a redirect at any moment.
        for (const { key, value: headerValue } of NO_STORE) missing.headers.set(key, headerValue);
        missing.headers.set("Content-Type", "text/html; charset=utf-8");
        missing.headers.set("x-request-id", requestId);
        return missing;
      }
    }
  }

  // 5–6. headers -------------------------------------------------------------------------------
  const dynamic = isDynamicPath(url.pathname);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-request-id", requestId);

  let value: string | undefined;
  if (dynamic) {
    value = nonce();
    requestHeaders.set("x-nonce", value);
    // Next reads the nonce it applies to its bootstrap and inline data scripts from the REQUEST's
    // Content-Security-Policy header (app-render parseRequestHeaders) - the documented pattern.
    // The routes under these prefixes render per request (`instant = false` + `connection()`), so
    // the nonce in the markup is the nonce in the response header.
    requestHeaders.set("Content-Security-Policy", csp("nonce", value, canonical.protocol === "https:"));
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  const https = canonical.protocol === "https:";
  for (const { key, value: headerValue } of securityHeaders(dynamic ? "nonce" : "cached", value, https)) {
    res.headers.set(key, headerValue);
  }
  if (dynamic) {
    for (const { key, value: headerValue } of NO_STORE) res.headers.set(key, headerValue);
    if (value !== undefined) res.headers.set("x-nonce", value);
  } else if (isEdgeCacheable(url.pathname)) {
    res.headers.set("Cache-Control", EDGE_CACHE);
  }
  res.headers.set("x-request-id", requestId);
  return res;
}

/**
 * DECISION (4 Sep 2026, performance review): the shared-cache policy of the spec ("CDN caches the
 * HTML for anonymous users, s-maxage 300, swr 86400") was never emitted - Next marks every
 * partially-static response `private, no-store`, so neither ArvanCloud nor any proxy could absorb an
 * Instagram peak. Catalogue and content pages carry no personal data (cart, wishlist, account state
 * are client-side or behind the dynamic prefixes above), so the origin says so explicitly.
 * `max-age=0` keeps browsers revalidating (bfcache handles back/forward); the CDN serves for five
 * minutes, then stale for a day while it refetches, and stale for a day if the origin is down.
 * The worker's `cdn.purge` job (tag → URL map) invalidates the edge on every admin write, exactly
 * as designed. Next honours a Cache-Control that is already on the response (send-payload guard).
 */
const EDGE_CACHE = "public, max-age=0, s-maxage=300, stale-while-revalidate=86400, stale-if-error=86400";
/** Route handlers that set their own policy (search index, sitemaps, health) keep it. */
const SELF_CACHED = ["/snapppay-feed.json", "/healthz", "/sitemaps", "/sitemap_index.xml", "/search-index.json", "/robots.txt", "/manifest.webmanifest"] as const;
function isEdgeCacheable(pathname: string): boolean {
  if (SELF_CACHED.some((p) => pathname === p || pathname === `${p}/` || pathname.startsWith(`${p}/`))) return false;
  return pathname === "/" || pathname.endsWith("/");
}

/** /my-account/…, /shop/page/N/, /category/…/page/N/, /checkout/ - the four DECIDED legacy shapes. */
function legacyRedirect(pathname: string): string | null {
  if (pathname === "/checkout" || pathname === "/checkout/") return "/billing/";
  return legacyMyAccountRedirect(pathname) ?? legacyPaginationRedirect(pathname);
}

function splitTarget(target: string): [string, string] {
  const q = target.indexOf("?");
  return q === -1 ? [target, ""] : [target.slice(0, q), target.slice(q)];
}

/** Legacy `?page=N` wins; every other original parameter is preserved. */
function mergeSearch(fromRedirect: string, original: string): string {
  if (fromRedirect === "") return original;
  const params = new URLSearchParams(original);
  for (const [key, val] of new URLSearchParams(fromRedirect)) params.set(key, val);
  const merged = params.toString();
  return merged === "" ? "" : `?${merged}`;
}

export const config = { matcher: ["/((?!_next/static|_next/image|media/|fonts/|icons/|screenshots/|favicon.ico|sw.js|sw-kill.js).*)"] };
