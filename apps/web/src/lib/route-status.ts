import { decPath, ensureTrailingSlash } from "@namilux/core/url";

/**
 * What a path is, decided BEFORE Next routes it.
 *
 * THE DEFECT THIS EXISTS FOR (found on r17, 7 Sep 2026). Under `cacheComponents` every dynamic
 * segment is partially prerendered: for a slug that `generateStaticParams` did not cover, Next
 * serves the route's fallback shell - status line already written, `x-nextjs-postponed: 1` on the
 * response - and only then resumes the render. By the time the segment discovers that the product
 * is gone, `notFound()` can no longer set 404 and `permanentRedirect()` can no longer set a
 * `Location` header: both merely swap the streamed body, so every dead URL answered 200 with the
 * Persian 404 inside it. 96 of the 182 redirect rows were written the same day by the catalogue
 * reduction; a soft 404 keeps all of them indexed and drops the 301 signal.
 *
 * A middleware answer is the only one that is still a status line. proxy.ts runs before routing, so
 * it can emit the row's real 301/410, or hand a genuinely unknown path to a route that matches
 * nothing - which Next already answers with a hard, prerendered 404 (`/foo/bar/baz/` measured 404
 * on the box while `/totally-random-path-xyz/` measured 200).
 *
 * The middleware runtime has no database and no "server-only" imports (see the DECISION in
 * proxy.ts), so the knowledge is fetched over loopback from `/api/internal/routes/` and held here:
 *   - a snapshot of every path that serves 200 (about 700 strings, refreshed every 30 s) - the fast
 *     path is a Set lookup and costs no I/O at all, which is what keeps home at ~17 ms and a
 *     product page at ~36 ms;
 *   - one definitive per-path question for anything the snapshot does not list, so a product
 *     published seconds ago is never 404ed by a stale snapshot.
 *
 * Every failure is answered `null` - "no opinion" - and the request is served exactly as it is
 * today. The oracle can only ever turn a wrong 200 into a right 301/404, never break a live page.
 */
export type RouteStatus =
  | { kind: "live" }
  | { kind: "redirect"; to: string; code: 301 | 410 }
  | { kind: "missing" };

/** Loopback only: Caddy answers 404 for /api/internal/* on the public hostname. */
export const INTERNAL_ROUTES_PATH = "/api/internal/routes/";

/**
 * A path that matches NO route in the app - two segments whose first is not a route folder does
 * that: `/[slug]` is one segment and every other dynamic segment sits under a literal prefix. Next
 * answers it with its prerendered `/_not-found` entry: a real 404 (`x-nextjs-cache: HIT`,
 * `x-nextjs-prerender: 1`) carrying the existing Persian page. `loadNotFoundPage` fetches that page
 * once and the proxy returns its body verbatim.
 */
export const NOT_FOUND_PATH = "/__404__/__404__/";

/**
 * Every first path segment the app itself owns - route folders under `app/` and `app/(site)/` plus
 * the folders in `public/`. A single-segment path that is NOT one of these is a post or a page in
 * the shared root namespace, and only those may be resolved. `lib/__tests__/route-status.test.ts`
 * reads both directories off disk and fails if a route folder is ever added without landing here.
 */
export const RESERVED_ROOT_SEGMENTS: ReadonlySet<string> = new Set([
  "_next",
  "account",
  "api",
  "billing",
  "blog",
  "brand",
  "cart",
  "category",
  "collection",
  "compare",
  "discount",
  "fonts",
  "gifts",
  "healthz",
  "icons",
  "ig",
  "media",
  "new",
  "offline",
  "pay",
  "product",
  "screenshots",
  "search",
  "shop",
  "sitemaps",
  "splash",
  "track",
  "wishlist",
]);

/**
 * The bare base of every reserved segment that NO route file serves - the last hole r18 left.
 *
 * Reported from the box after r18: `/product/`, `/brand/`, `/collection/`, `/category/`, `/pay/`
 * and `/sitemaps/` still answered **200 with the Persian 404 inside**; `/api/` and `/splash/` are
 * the same shape and came out of the route folders. Their folders under `app/` hold
 * only a dynamic child (`product/[slug]`, `category/[...slug]`, `sitemaps/[name]`, …), so there is
 * no route entry for the base itself and `(site)/[slug]` - the one-segment catch-all - matches it
 * with `slug = "product"`, finds nothing in the posts/pages tables and renders the not-found body
 * into a status line that was already written. `RESERVED_ROOT_SEGMENTS` is what kept the oracle off
 * them: it exists so a live page is never 404ed, and it skipped these along with the real pages.
 *
 * So the hole is closed with the narrowest possible list - the exact bases, not a loosening of the
 * reserved rule - and the answer is still the oracle's, never a hard-coded 404. That matters twice
 * over: a base the `redirects` table owns gets its real 301 (`/collection/` → `/shop/` the day the
 * shop stops running seasons), and a base that a content page happens to occupy is answered **live**
 * - `loadLiveRoutes()` lists every root page as `/<slug>/`, so a page slugged "pay" keeps its 200.
 *
 * `lib/__tests__/route-status.test.ts` derives this set from the route folders themselves, in both
 * directions: a new dynamic-only namespace must land here, and a base that gains a `page.tsx` must
 * leave. Segments the proxy's own matcher excludes (`media/`, `fonts/`, `icons/`, `screenshots/`)
 * are not listed - middleware never runs for them, so listing them would be decoration. `_next` is
 * likewise absent: it is Next's asset namespace, not a route folder of this app.
 */
export const UNSERVED_ROOT_BASES: ReadonlySet<string> = new Set([
  "/api/",
  "/brand/",
  "/category/",
  "/collection/",
  "/pay/",
  "/product/",
  "/sitemaps/",
  "/splash/",
]);

/** Same reading as core's `normalizePath`: an extension starts with a letter, so "kf-2.0" is a slug. */
const FILE_EXTENSION_RE = /\.[a-z][a-z0-9]{1,11}$/;
const MULTI_SLASH_RE = /\/{2,}/g;

/** The catalogue namespaces that take exactly one slug. */
const ONE_SLUG_PREFIXES: ReadonlySet<string> = new Set(["product", "brand", "collection"]);

/**
 * The decoded, trailing-slashed path to ask about, or null when this request is none of the
 * oracle's business - the static routes, the personal prefixes, the file routes, everything under
 * a first segment the app itself owns except the `UNSERVED_ROOT_BASES` bases, which the app owns
 * and no route file serves. Case is preserved: the lookup compares against real slugs, and
 * lowercasing a path the catalogue does not hold in lower case would invent a 404.
 *
 * A first segment that is NOT the app's own can only ever be a root-namespace slug (posts and
 * pages) or a legacy WordPress shape that matches no route at all - `/product-category/…` is 33 of
 * the table's rows, and it was 404ing on the box because nothing rendered it and so nothing ever
 * read its row. Both are the redirects table's business, at any depth.
 */
export function resolvableKey(pathname: string): string | null {
  const decoded = decPath(pathname).replace(MULTI_SLASH_RE, "/");
  if (!decoded.startsWith("/")) return null;
  const path = ensureTrailingSlash(decoded);
  if (path === "/") return null;
  // `loadNotFoundPage` fetches this one over loopback and that request comes back through here:
  // resolving it would ask the oracle a question whose answer is the page being fetched.
  if (path === NOT_FOUND_PATH) return null;
  const segments = path.slice(1, -1).split("/");
  if (segments.some((s) => s === "")) return null;
  // Before the per-namespace arity rules, which would send every one of these back as null: a bare
  // base is exactly the arity those rules reject, and it is the one arity nothing renders.
  if (UNSERVED_ROOT_BASES.has(path)) return path;
  const head = segments[0] ?? "";
  if (ONE_SLUG_PREFIXES.has(head)) return segments.length === 2 ? path : null;
  if (head === "category") return segments.length >= 2 ? path : null;
  // The file routes all live at the root: robots.txt, sw.js, the sitemap children, the manifest.
  if (segments.length === 1 && FILE_EXTENSION_RE.test(head)) return null;
  return RESERVED_ROOT_SEGMENTS.has(head) ? null : path;
}

const TTL_MS = 30_000;
/** After a failed refresh, do not hammer the endpoint from every request. */
const RETRY_MS = 5_000;
const TIMEOUT_MS = 1_500;
const MAX_REFERER = 512;

type Snapshot = { live: ReadonlySet<string>; at: number };

let snapshot: Snapshot | null = null;
let refreshing: Promise<Snapshot | null> | null = null;
let lastAttempt = 0;
let notFoundPage: string | null = null;
let notFoundAttempt = 0;

/** Test seam: the module holds process-lifetime state, and each case needs its own. */
export function resetRouteSnapshot(): void {
  snapshot = null;
  refreshing = null;
  lastAttempt = 0;
  notFoundPage = null;
  notFoundAttempt = 0;
}

/** `http://127.0.0.1:3000` - the address this very Node process binds (systemd sets both). */
function loopbackBase(): string {
  return `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
}

/**
 * The canonical host has to travel with every loopback call: with `TRUST_PROXY` on, this very proxy
 * compares `x-forwarded-host` against `SITE_ORIGIN` and answers 301 to the canonical origin when
 * they differ - the failure `packages/config/src/internal-target.ts` documents for the revalidate
 * hook. `Host` itself is left to the fetch implementation (a forbidden header name in the edge
 * runtime); `x-forwarded-host` is the one `lib/request-origin.ts` actually reads.
 */
function forwardedHeaders(): Record<string, string> | null {
  try {
    const url = new URL(process.env.SITE_ORIGIN ?? "https://namilux.ir");
    return {
      "x-forwarded-host": url.host,
      "x-forwarded-proto": url.protocol === "http:" ? "http" : "https",
      "x-forwarded-for": "127.0.0.1",
    };
  } catch {
    return null;
  }
}

/**
 * The body of the app's own 404, read once over loopback and then held for the life of the process
 * (a release restarts it, so it can never go stale).
 *
 * DECISION (7 Sep 2026, measured twice on the box): the proxy returns this body itself instead of
 * rewriting to `NOT_FOUND_PATH`, because there is no rewrite URL that is safe in both directions.
 * Next's router only treats `x-middleware-rewrite` as INTERNAL when its origin equals the `initURL`
 * router-server builds - `${x-forwarded-proto}://${HOSTNAME}:${PORT}` - and hands anything else to
 * an external proxy. `NextResponse.rewrite(new URL(…, req.nextUrl))`, the documented form, produced
 * `https://localhost:3000/…` and Next proxied it back at its own plain-http port: EPROTO, 500 on
 * every unknown path (r18-13be2e5). A site-relative value crashes earlier still - the edge adapter
 * does `new NextURL(rewrite)` with no base, `ERR_INVALID_URL`, 500 again (r18-720843b). Matching
 * `initURL` exactly would mean writing `https://` at a port that speaks http, so the moment the
 * guess is wrong it is a 500 rather than a slow path. Fetching the page is none of that: it is one
 * request per process against an address this process is listening on.
 *
 * The 404 status is required of the answer, not assumed: if `NOT_FOUND_PATH` ever starts matching a
 * route, this returns null and the proxy leaves the request alone instead of serving that page's
 * body as a 404.
 */
export async function loadNotFoundPage(): Promise<string | null> {
  if (notFoundPage !== null) return notFoundPage;
  const now = Date.now();
  if (notFoundAttempt !== 0 && now - notFoundAttempt < RETRY_MS) return null;
  notFoundAttempt = now;
  const headers = forwardedHeaders();
  if (headers === null) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${loopbackBase()}${NOT_FOUND_PATH}`, {
      headers: { ...headers, accept: "text/html" },
      signal: controller.signal,
      cache: "no-store",
      redirect: "manual",
    });
    if (res.status !== 404) return null;
    const html = await res.text();
    if (!html.includes("</html>")) return null;
    notFoundPage = html;
    return html;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readKind(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : null;
}

function readRedirect(value: unknown): RouteStatus | null {
  if (readKind(value) !== "redirect") return null;
  const row = value as { to?: unknown; code?: unknown };
  if (typeof row.to !== "string") return null;
  if (row.code !== 301 && row.code !== 410) return null;
  return { kind: "redirect", to: row.to, code: row.code };
}

/** The loopback question. Answers `null` on anything that is not a well-formed reply. */
async function callInternal(query: string, referer: string | null): Promise<unknown> {
  const forwarded = forwardedHeaders();
  if (forwarded === null) return null;
  const headers: Record<string, string> = { ...forwarded, accept: "application/json" };
  if (referer !== null && referer !== "") headers["x-nl-referer"] = referer.slice(0, MAX_REFERER);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${loopbackBase()}${INTERNAL_ROUTES_PATH}${query}`, {
      headers,
      signal: controller.signal,
      cache: "no-store",
      redirect: "manual",
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    // The oracle never breaks a request: an unreachable endpoint means "no opinion".
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function refresh(): Promise<Snapshot | null> {
  refreshing ??= (async (): Promise<Snapshot | null> => {
    try {
      lastAttempt = Date.now();
      const body = await callInternal("", null);
      const live = typeof body === "object" && body !== null ? (body as { live?: unknown }).live : undefined;
      if (Array.isArray(live)) {
        snapshot = { live: new Set(live.filter((p): p is string => typeof p === "string")), at: Date.now() };
      } else if (snapshot !== null) {
        // Keep serving the old set rather than falling back to "no opinion" on a blip.
        snapshot = { live: snapshot.live, at: Date.now() - TTL_MS + RETRY_MS };
      }
      return snapshot;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function liveSnapshot(): Promise<Snapshot | null> {
  const now = Date.now();
  if (snapshot !== null && now - snapshot.at < TTL_MS) return snapshot;
  if (snapshot !== null) {
    // Stale-while-revalidate: the request in hand is answered from the old set, never delayed.
    void refresh();
    return snapshot;
  }
  if (refreshing === null && lastAttempt !== 0 && now - lastAttempt < RETRY_MS) return null;
  return await refresh();
}

/**
 * `null` means "no opinion, serve it the way the router would" - the answer for an unreachable
 * endpoint, a malformed reply and a timeout.
 */
export async function resolveRouteStatus(path: string, referer: string | null): Promise<RouteStatus | null> {
  const snap = await liveSnapshot();
  if (snap === null) return null;
  if (snap.live.has(path)) return { kind: "live" };

  // Not in the snapshot: either genuinely gone, or newer than the snapshot. One definitive query.
  const body = await callInternal(`?path=${encodeURIComponent(path)}`, referer);
  const redirect = readRedirect(body);
  if (redirect !== null) return redirect;
  const kind = readKind(body);
  if (kind === "live") return { kind: "live" };
  if (kind === "missing") return { kind: "missing" };
  return null;
}
