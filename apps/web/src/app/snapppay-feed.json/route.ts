import { feedPaging } from "@namilux/core";
import { snapppayFeedOne, snapppayFeedPage } from "@/server/snapppay-feed";
/**
 * GET /snapppay-feed.json?page=1&size=100   (or ?id=117 / ?slug=…)
 *
 * The product feed SnappPay's search reads (core/catalog/snapppay-feed.ts). A root file route: the
 * extension keeps it clear of the trailing-slash redirect and of the route oracle in proxy.ts, so a
 * plain `curl` gets a 200 with JSON and nothing in between. No authentication, no rate limit, allowed
 * in robots.txt. Served on the main storefront independently of payment credentials.
 */
const JSON_HEADERS = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=0, must-revalidate",
    "Access-Control-Allow-Origin": "*",
};
export async function GET(req: Request): Promise<Response> {
    const params = new URL(req.url).searchParams;
    const id = params.get("id")?.trim();
    const slug = params.get("slug")?.trim();
    if ((id !== undefined && id !== "") || (slug !== undefined && slug !== "")) {
        const item = await snapppayFeedOne({ ...(id ? { id } : {}), ...(slug ? { slug } : {}) });
        if (item === null)
            return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: JSON_HEADERS });
        return new Response(JSON.stringify({ products: [item] }), { headers: JSON_HEADERS });
    }
    const { page, size } = feedPaging({ page: params.get("page"), size: params.get("size") });
    return new Response(JSON.stringify(await snapppayFeedPage(page, size)), { headers: JSON_HEADERS });
}
