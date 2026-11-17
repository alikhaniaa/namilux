import { ROUTES, absUrl, brandUrl, categoryUrl, collectionUrl, pageUrl, postUrl, productUrl } from "../url";
// DECISION: `SITEMAP_NAMES` is imported from ../constants (pure data, no cycle, already the source
// used by ../seo/sitemaps.ts) rather than re-typing the nine legacy child names here - duplicating
// them would let the purge list drift from the sitemap Google actually crawls.
import { SITEMAP_NAMES } from "../constants";
import { tags } from "./tags";

export const MAX_PURGE_URLS = 500;

/** Returned as the first element when the list would exceed MAX_PURGE_URLS: "purge all HTML". */
export const PURGE_ALL_SENTINEL = "*";

export type PurgeLookups = {
  productSlug(id: number): Promise<string | null>;
  categoryPath(id: number): Promise<string | null>;
  brandSlug(id: number): Promise<string | null>;
  collectionSlug(id: number): Promise<string | null>;
};

/** The fixed pages a family tag stands for; the storefront never renders them from one entity. */
const CATALOG_PATHS = [ROUTES.shop, ROUTES.discount, ROUTES.new, ROUTES.gifts] as const;
const NAV_PATHS = [ROUTES.home, ROUTES.shop] as const;
const SITEMAP_PATHS = [ROUTES.sitemapIndex, ...SITEMAP_NAMES.map((name) => `/${name}`)] as const;

const ENTITY_TAG_RE = /^(product|category|brand|collection):(\d+)$/u;
const SLUG_TAG_RE = /^(post|page):(.+)$/u;

function dedupe(list: readonly string[]): string[] {
  return [...new Set(list)];
}

/**
 * DECISION: "content" is not in the contract list. It is the family tag of posts/pages, so it maps
 * to the blog index - the only fixed HTML page a content write can staleness-break. Purging one
 * extra listing page is cheaper than a stale journal rail.
 * DECISION: "menu:*" maps to the nav family for the same reason (a menu only appears in the shell).
 */
function familyPathsFor(tag: string): readonly string[] | null {
  switch (tag) {
    case tags.home:
      return [ROUTES.home];
    case tags.nav:
      return NAV_PATHS;
    case tags.catalog:
      return CATALOG_PATHS;
    case tags.sitemap:
      return SITEMAP_PATHS;
    case tags.search:
      return [ROUTES.searchIndex];
    case tags.settings:
      return [ROUTES.home];
    case tags.content:
      return [ROUTES.blog];
    default:
      return tag.startsWith("menu:") ? NAV_PATHS : null;
  }
}

/**
 * DECISION: a lookup that returns null yields no URL. The rules line ("if a lookup returns null
 * (archived), still purge the URL") describes the archived case, where the slug is still known - 
 * without a slug there is no path to mint, and guessing one would break the encoding contract.
 */
async function entityPathFor(tag: string, lookups: PurgeLookups): Promise<string | null> {
  const slugMatch = SLUG_TAG_RE.exec(tag);
  if (slugMatch) {
    const [, kind, slug] = slugMatch as unknown as [string, string, string];
    return kind === "post" ? postUrl(slug) : pageUrl(slug);
  }
  const match = ENTITY_TAG_RE.exec(tag);
  if (!match) return null;
  const [, kind, rawId] = match as unknown as [string, string, string];
  const id = Number(rawId);
  if (!Number.isSafeInteger(id)) return null;
  switch (kind) {
    case "product": {
      const slug = await lookups.productSlug(id);
      return slug === null || slug === "" ? null : productUrl(slug);
    }
    case "category": {
      const path = await lookups.categoryPath(id);
      return path === null || path === "" ? null : categoryUrl(path);
    }
    case "brand": {
      const slug = await lookups.brandSlug(id);
      return slug === null || slug === "" ? null : brandUrl(slug);
    }
    default: {
      const slug = await lookups.collectionSlug(id);
      return slug === null || slug === "" ? null : collectionUrl(slug);
    }
  }
}

export async function urlsForTags(
  tagList: string[],
  lookups: PurgeLookups,
  origin: string,
): Promise<string[]> {
  const unique = dedupe(tagList.filter((tag) => typeof tag === "string" && tag !== "")).sort();
  const familyPaths: string[] = [];
  const entityTags: string[] = [];
  for (const tag of unique) {
    const paths = familyPathsFor(tag);
    if (paths === null) entityTags.push(tag);
    else familyPaths.push(...paths);
  }

  // DECISION: the lookups run sequentially. They are DB reads issued by the worker against a small
  // pool; 500 parallel round-trips would starve it for no latency the purge job cares about.
  const entityPaths: string[] = [];
  for (const tag of entityTags) {
    const path = await entityPathFor(tag, lookups);
    if (path !== null) entityPaths.push(path);
  }

  const family = dedupe(familyPaths.map((path) => absUrl(origin, path)));
  const all = dedupe([...family, ...entityPaths.map((path) => absUrl(origin, path))]);
  if (all.length > MAX_PURGE_URLS) return [PURGE_ALL_SENTINEL, ...family];
  return all;
}
