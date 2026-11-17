import { ROBOTS_DISALLOW } from "@namilux/core";
import type { MetadataRoute } from "next";
import { env } from "@/env";
// DECISION: the path list is core's `ROBOTS_DISALLOW` (the same array `seo/sitemaps.robotsTxt`
// renders for the admin/Caddy variant) so the storefront and the admin host can never drift.
export default function robots(): MetadataRoute.Robots {
    return {
        rules: [{ userAgent: "*", allow: "/", disallow: [...ROBOTS_DISALLOW] }],
        sitemap: `${env.SITE_ORIGIN}/sitemap_index.xml`,
        host: env.SITE_ORIGIN,
    };
}
