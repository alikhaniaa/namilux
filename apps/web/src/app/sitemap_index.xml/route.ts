import { renderIndexXml, sitemapIndex, tags } from "@namilux/core";
import { tagContent } from "@/lib/cache";
import { db } from "@/lib/db";
import { publishesSitemap } from "@/server/sitemap-channel";
import { env } from "@/env";

// The index is the URL Google already knows. It is cached under the `sitemap` tag so an admin write
// (which revalidates that tag) republishes it, and the child `lastmod` values come from the
// entities - never the build date. The origin is an argument so it is part of the cache key: the two
// storefronts never share an entry.
async function body(origin: string): Promise<string> {
  "use cache";
  tagContent([tags.sitemap], "days");
  const entries = await sitemapIndex(db, { origin });
  return renderIndexXml(
    entries.filter((entry) => publishesSitemap(entry.name)),
    origin,
  );
}

export async function GET(): Promise<Response> {
  return new Response(await body(env.SITE_ORIGIN), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
