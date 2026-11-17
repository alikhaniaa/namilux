import "server-only";
import type { SitemapName } from "@namilux/core";
/** The main storefront publishes the complete catalogue and content sitemap. */
export function publishesSitemap(_name: SitemapName): boolean { return true; }
