import { tags } from "./tags";
import type { BannerSlot } from "../constants";

export type ProductChange = "content" | "price" | "stock" | "images" | "status" | "seo" | "relations";

/**
 * A change that moves the product CARD (price, badge, availability) or moves the product between
 * lists: every family page that renders the card goes stale.
 * DECISION: "relations" joins price/stock/status here even though the contract comment names only
 * the first three - a membership change is exactly a change of which category/collection page must
 * re-render, and the spec prefers over-invalidation. It deliberately does NOT add "home", which the
 * contract reserves for price/stock/status (the home rails are price/stock driven).
 */
const FAMILY_CHANGES: ReadonlySet<ProductChange> = new Set<ProductChange>(["price", "stock", "status", "relations"]);
const HOME_CHANGES: ReadonlySet<ProductChange> = new Set<ProductChange>(["price", "stock", "status"]);
/**
 * DECISION: "seo" joins "status" for the sitemap tag. The contract names only status, but the
 * sitemap carries `lastmod` and feeds the canonical of every entity, so an SEO edit that did not
 * refresh it would serve a sitemap contradicting the page - the one thing the spec forbids.
 */
const SITEMAP_CHANGES: ReadonlySet<ProductChange> = new Set<ProductChange>(["status", "seo"]);

/** Settings prefixes whose values are rendered by the shell (header/promo) and the home page. */
const SETTINGS_HOME_NAV_PREFIXES = ["store.", "promo.", "seo."] as const;

const HOME_BANNER_SLOTS: ReadonlySet<BannerSlot> = new Set<BannerSlot>(["promo_bar", "home_hero", "home_band"]);
const CATALOG_BANNER_SLOTS: ReadonlySet<BannerSlot> = new Set<BannerSlot>([
  "plp_inline",
  "category_tile",
  "pdp_band",
]);

export function dedupeTags(list: string[]): string[] {
  const seen = new Set<string>();
  for (const tag of list) {
    if (typeof tag === "string" && tag !== "") seen.add(tag);
  }
  return [...seen].sort();
}

export function tagsForProductChange(
  p: {
    id: number;
    categoryIds: number[];
    brandId: number | null;
    collectionIds: number[];
    modelSiblingIds?: number[];
  },
  change: ProductChange,
): string[] {
  const out: string[] = [tags.product(p.id), tags.catalog, tags.search];
  if (FAMILY_CHANGES.has(change)) {
    for (const id of p.categoryIds) out.push(tags.category(id));
    if (p.brandId !== null) out.push(tags.brand(p.brandId));
    for (const id of p.collectionIds) out.push(tags.collection(id));
    // Variants share one card: a sibling's price/stock changes what the group's card shows.
    for (const id of p.modelSiblingIds ?? []) out.push(tags.product(id));
  }
  if (HOME_CHANGES.has(change)) out.push(tags.home);
  if (SITEMAP_CHANGES.has(change)) out.push(tags.sitemap);
  return dedupeTags(out);
}

export function tagsForCategoryChange(c: { id: number; parentId: number | null }): string[] {
  const out: string[] = [tags.category(c.id), tags.nav, tags.catalog, tags.sitemap];
  if (c.parentId !== null) out.push(tags.category(c.parentId));
  return dedupeTags(out);
}

export function tagsForBrandChange(id: number): string[] {
  // The set ../catalog/brands.ts already returns from upsertBrand (brand chapters are on home).
  return dedupeTags([tags.brand(id), tags.nav, tags.catalog, tags.home, tags.sitemap]);
}

export function tagsForCollectionChange(id: number, isNav: boolean): string[] {
  const out: string[] = [tags.collection(id), tags.catalog, tags.home, tags.sitemap];
  if (isNav) out.push(tags.nav);
  return dedupeTags(out);
}

export function tagsForPostChange(slug: string): string[] {
  return dedupeTags([tags.post(slug), tags.content, tags.home, tags.sitemap]);
}

export function tagsForPageChange(slug: string): string[] {
  // DECISION: no "nav". ../content/pages.ts pushes `tags.nav` onto this array itself, and only when
  // the title changed (its own rules); adding it here unconditionally would make that branch dead.
  return dedupeTags([tags.page(slug), tags.content, tags.sitemap]);
}

export function tagsForMenuChange(key: string): string[] {
  return dedupeTags([tags.menu(key), tags.nav]);
}

/**
 * DECISION (signature): the contract line writes `tagsForBannerChange(slot)`, but the caller
 * (../content/banners.ts upsertBanner, DONE) needs the targeting of the banner in the tag set
 * ("brand/collection tags" - its own rules). The caller wins: `targeting` is a second, OPTIONAL
 * parameter, so `tagsForBannerChange(slot)` still typechecks exactly as the contract writes it.
 * DECISION (tags): `promo_bar` emits BOTH "nav" (this module) and "home" (the caller's rule). The
 * promo bar is rendered by the shell and mirrored on home; over-invalidating one cached page is
 * cheaper than serving a campaign bar that has already expired.
 */
export function tagsForBannerChange(
  slot: BannerSlot,
  targeting?: { brandId?: number | null; collectionId?: number | null },
): string[] {
  const out: string[] = [tags.content];
  if (HOME_BANNER_SLOTS.has(slot)) out.push(tags.home);
  if (slot === "promo_bar") out.push(tags.nav);
  if (CATALOG_BANNER_SLOTS.has(slot)) out.push(tags.catalog);
  const brandId = targeting?.brandId;
  const collectionId = targeting?.collectionId;
  if (typeof brandId === "number") out.push(tags.brand(brandId));
  if (typeof collectionId === "number") out.push(tags.collection(collectionId));
  return dedupeTags(out);
}

export function tagsForSettingsChange(key: string): string[] {
  const out: string[] = [tags.settings];
  // Mirrors ../settings/service.ts setSetting, which returns the same pair for these prefixes.
  if (SETTINGS_HOME_NAV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    out.push(tags.home, tags.nav);
  }
  return dedupeTags(out);
}
