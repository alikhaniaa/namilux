import { loadSearchIndex } from "@/server/loaders/catalog";

/**
 * the spec: this is the one endpoint that hands out many products at once, so it carries only
 * the public tile data the search overlay draws - no cost price, no stock level, no internal ids
 * beyond the product id that is already in every URL. The shape is fixed by the spec.
 *
 * DECISION (channel work): the body and its weak ETag come from `loaders/catalog.loadSearchIndex`,
 * which was already the identical cached builder. One builder means the instalment site cannot end
 * up serving an index priced for the main site.
 */
export async function GET(req: Request): Promise<Response> {
  const { body, etag } = await loadSearchIndex();
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    ETag: etag,
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}
