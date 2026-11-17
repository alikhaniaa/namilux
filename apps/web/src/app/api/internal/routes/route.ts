import { getCollectionBySlug, recordNotFound, resolveRedirect, servesLivePath } from "@namilux/core";
import { db } from "@/lib/db";
import { clientIp } from "@/lib/http-handler";
import { loadLiveRoutes } from "@/server/loaders/routes";

/**
 * The proxy's route oracle (see lib/route-status.ts for why it exists at all).
 *
 * Two questions, one handler:
 *   GET /api/internal/routes/                -> { live: [ …every path that answers 200… ] }
 *   GET /api/internal/routes/?path=/x/y/     -> { kind: "live" | "redirect" | "missing" }
 *
 * The list answers the fast path out of one cached entry; the single-path form is the definitive
 * one, asked only when the proxy's snapshot does not list the path, and is what keeps a product
 * published seconds ago from being 404ed by a stale snapshot.
 *
 * The path is read from the request, so this route is dynamic and is never prerendered.
 *
 * Gate: loopback only. Caddy answers 404 for /api/internal/* on the public hostname; this is the
 * app-level belt behind that brace. There is no HMAC - unlike the revalidate hook this route
 * changes nothing and returns only public URLs - and no secret may be baked into the edge bundle
 * that would have to sign it.
 */
const PRIVATE_IP =
  /^(?:$|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|::1$|f[cd][0-9a-f]{2}:)/i;

const MAX_PATH = 2048;
const NO_STORE = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } as const;
const COLLECTION_PREFIX = "/collection/";

const json = (body: unknown): Response => new Response(JSON.stringify(body), { headers: NO_STORE });

/**
 * `servesLivePath` is the predicate the URL-contract check and the archive flow already share, and
 * it covers the four namespaces the 752 legacy URLs live in. Collections were never part of that
 * contract and it does not know them, so the one missing namespace is asked separately here rather
 * than by editing a predicate two other callers depend on.
 */
async function servesLive(path: string): Promise<boolean> {
  if (await servesLivePath(db, path)) return true;
  if (!path.startsWith(COLLECTION_PREFIX)) return false;
  const slug = path.slice(COLLECTION_PREFIX.length).replace(/\/+$/, "");
  if (slug === "" || slug.includes("/")) return false;
  return (await getCollectionBySlug(db, slug)) !== null;
}

export async function GET(req: Request): Promise<Response> {
  if (!PRIVATE_IP.test(clientIp(req))) return new Response(null, { status: 404 });

  const path = new URL(req.url).searchParams.get("path");
  if (path === null) return json({ live: await loadLiveRoutes() });
  if (path === "" || !path.startsWith("/") || path.length > MAX_PATH) return json({ kind: "missing" });

  // The cached list first: it is a memory hit and it already knows the namespaces (collections,
  // seasons) that cost several queries to re-derive.
  if ((await loadLiveRoutes()).includes(path)) return json({ kind: "live" });
  if (await servesLive(path)) return json({ kind: "live" });

  const hit = await resolveRedirect(db, path);
  if (hit !== null) return json({ kind: "redirect", to: hit.to, code: hit.code });

  // The 404 monitor used to be fed from the catalogue segments' miss branch; the proxy now answers
  // before those ever render, so the record is written here - from the one place that knows both
  // that the path is genuinely unknown and what referred to it. Fire-and-forget, throttled per
  // path inside `recordNotFound`: monitoring must never delay or fail a 404.
  const referrer = req.headers.get("x-nl-referer") ?? undefined;
  void recordNotFound(db, path, referrer).catch(() => undefined);
  return json({ kind: "missing" });
}
