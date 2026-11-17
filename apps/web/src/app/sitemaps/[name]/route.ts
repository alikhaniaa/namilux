import { SITEMAP_CHILDREN, buildSitemap, renderSitemapXml, tags } from "@namilux/core";
import type { SitemapName } from "@namilux/core";
import { tagContent } from "@/lib/cache";
import { db } from "@/lib/db";
import { publishesSitemap } from "@/server/sitemap-channel";
import { env } from "@/env";

function isChild(name: string): name is SitemapName {
  return (SITEMAP_CHILDREN as readonly string[]).includes(name);
}

// One cached body per child name and origin. `name` is validated against the closed list before it
// reaches the cache key, so an arbitrary path cannot mint cache entries.
async function body(name: SitemapName, origin: string): Promise<string> {
  "use cache";
  tagContent([tags.sitemap], "days");
  return renderSitemapXml(await buildSitemap(db, name, { origin }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }): Promise<Response> {
  const { name } = await ctx.params;
  // The instalment storefront publishes only its shopping children (server/sitemap-channel.ts).
  if (!isChild(name) || !publishesSitemap(name)) return new Response(null, { status: 404 });
  return new Response(await body(name, env.SITE_ORIGIN), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
