import {
  and,
  desc,
  eq,
  gt,
  inArray,
  media as mediaTable,
  pages as pagesTable,
  productImages,
  products,
  sql,
} from "@namilux/db";
import type { Db, Row } from "@namilux/db";
import type { MenuItem } from "../content/menus";
import { getMenus, isSafeHref } from "../content/menus";
import type { ImageRef } from "./media";
import type { MediaRowLike } from "./media";
import { toImageRef } from "./media";
import { MENU_KEYS } from "../constants";
import type { MenuKey } from "../constants";
import { brandUrl, categoryUrl, collectionUrl, pageUrl } from "../url";
import { listBrands } from "./brands";
import { listCollections } from "./collections";
import { listCategoryTree } from "./categories";
import { counts as catalogueCounts } from "./products.repo";

// DECISION (M0 step 3): NavBrand / NavCollection / NavData are declared once in ../types
// (the spec §catalog · getNavData).
import type {
  NavBrand,
  NavCollection,
  NavCollectionChild,
  NavCounts,
  NavData,
  ResolvedMenuItem,
} from "../types";

// DECISION (M1): ../types now carries this file's contract shapes verbatim (they gained `href`,
// `children` and `generatedAt`), so all five are re-exported from there rather than re-declared - 
// a second declaration is a TS2308 duplicate export at src/index.ts.
export type { NavBrand, NavCollection, NavCounts, NavData, ResolvedMenuItem };

export type NavLookups = {
  brandBySlug: (s: string) => NavBrand | null;
  collectionBySlug: (s: string) => NavCollection | null;
  categoryByPath: (p: string) => { name: string; path: string; count: number } | null;
  pageBySlug: (s: string) => { title: string; slug: string } | null;
};

/**
 * `count` is `number | null` on `ResolvedMenuItem` (null for the url and page kinds, which have
 * nothing to count). It used to collapse to `number` because `MenuItem` carried an optional
 * `count`; those resolved-only keys were dropped from `MenuItem` at M1, so this is now a plain
 * alias kept for readability at the build site.
 */
type ResolvedNode = ResolvedMenuItem;

// ---------------------------------------------------------------- pure resolution

/** A ref is only ever a slug or a category path; menus.ts already stored it trimmed + lowercase. */
const refOf = (item: MenuItem): string | null => {
  const ref = typeof item.ref === "string" ? item.ref.trim() : "";
  return ref === "" ? null : ref;
};

/** Every emitted URL comes from url/*; an unusable ref makes the url module throw. */
function safely(mint: () => string): string | null {
  try {
    const href = mint();
    return isSafeHref(href) ? href : null;
  } catch {
    return null;
  }
}

/**
 * DECISION: the return type is `ResolvedMenuItem | null`, not the header's bare `ResolvedMenuItem`.
 * The same header's rules require that an item pointing at an inactive brand, a non-live collection,
 * an archived category, an unpublished page or an unsafe href be DROPPED, and a pure function has no
 * other channel to say so (`toImageRef` and `getBrandBySlug` answer the same way). The name and the
 * parameter order are unchanged; getNavData filters the nulls out.
 */
export function resolveMenuItem(item: MenuItem, lookups: NavLookups): ResolvedMenuItem | null {
  if (typeof item !== "object" || item === null) return null;

  const label = typeof item.label === "string" ? item.label.trim() : "";
  let href: string | null = null;
  let count: number | null = null;
  let image: ImageRef | null = null;
  let entityLabel = "";

  switch (item.kind) {
    case "url": {
      // EDGE CASE: "javascript:…", "//evil.example", "http://…" - dropped, never emitted.
      const raw = typeof item.href === "string" ? item.href.trim() : "";
      if (!isSafeHref(raw)) return null;
      href = raw;
      break;
    }
    case "brand": {
      const ref = refOf(item);
      if (ref === null) return null;
      // EDGE CASE: ref "SMEG" resolves case-insensitively and the href is minted from the row's slug.
      const brand = lookups.brandBySlug(ref.toLowerCase());
      if (brand === null) return null;
      href = safely(() => brandUrl(brand.slug));
      count = brand.count;
      image = brand.image;
      entityLabel = brand.name;
      break;
    }
    case "collection": {
      const ref = refOf(item);
      if (ref === null) return null;
      // EDGE CASE: a campaign whose window ended is not in the lookup → dropped.
      const collection = lookups.collectionBySlug(ref.toLowerCase());
      if (collection === null) return null;
      href = safely(() => collectionUrl(collection.slug));
      count = collection.count;
      image = collection.image;
      entityLabel = collection.name;
      break;
    }
    case "category": {
      const ref = refOf(item);
      if (ref === null) return null;
      const category = lookups.categoryByPath(ref);
      if (category === null) return null;
      href = safely(() => categoryUrl(category.path));
      count = category.count;
      entityLabel = category.name;
      break;
    }
    case "page": {
      const ref = refOf(item);
      if (ref === null) return null;
      const page = lookups.pageBySlug(ref.toLowerCase());
      if (page === null) return null;
      href = safely(() => pageUrl(page.slug));
      // rules: `count` is null for url and page items - there is nothing to count beside them.
      entityLabel = page.title;
      break;
    }
    default:
      return null;
  }

  if (href === null) return null;
  // DECISION: an item saved without a label falls back to the resolved entity's name rather than
  // rendering an empty row; menus.setMenu makes an empty label impossible, but jsonb is jsonb.
  const finalLabel = label === "" ? entityLabel.trim() : label;
  if (finalLabel === "") return null;

  const children: ResolvedMenuItem[] = [];
  for (const child of item.children ?? []) {
    const resolved = resolveMenuItem(child, lookups);
    if (resolved !== null) children.push(resolved);
  }

  const node: ResolvedNode = {
    label: finalLabel,
    kind: item.kind,
    href,
    count,
    image,
    children,
  };
  if (typeof item.ref === "string" && item.ref.trim() !== "") node.ref = item.ref.trim();
  if (typeof item.badge === "string" && item.badge.trim() !== "") node.badge = item.badge.trim();

  return node;
}

// ---------------------------------------------------------------- lookups from the database

type MediaRow = Row<typeof mediaTable>;

/**
 * DECISION: local here (and in ./brands, ./collections, ../content/banners) because the module whose
 * contract owns `MediaRowLike` exports no row mapper.
 */
function mediaRowLike(row: MediaRow): MediaRowLike {
  const r = row.renditionsJson;
  const n = row.normalizeJson;
  return {
    id: row.id,
    kind: row.kind,
    storageKey: row.storageKey,
    mime: row.mime,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    alt: row.alt,
    lqip: row.lqip,
    renditionsJson: r == null ? null : { master: r.master, avif: r.avif ?? {}, webp: r.webp ?? {} },
    normalizeJson:
      n == null
        ? null
        : {
            ...(n.subjectH === undefined ? {} : { subjectH: n.subjectH }),
            ...(n.widthBound === undefined ? {} : { widthBound: n.widthBound }),
            ...(n.quarantined === undefined ? {} : { quarantined: n.quarantined }),
            ...(n.reason == null ? {} : { reason: n.reason }),
          },
  };
}

/**
 * The drawer's 40 px row art for a brand with no logo: the primary image of its highest-priced
 * available product (rules).
 * DECISION: ONE statement for every logo-less brand (never one per brand - products.repo rules), and
 * the availability term omits the reservation subquery that list.ts uses: a reserved unit does not
 * change which picture decorates a nav row, and the cheaper predicate keeps `nav` fast.
 */
async function brandFallbackImages(
  db: Db,
  brandIds: readonly number[],
  altByBrandId: ReadonlyMap<number, string>,
): Promise<Map<number, ImageRef>> {
  const out = new Map<number, ImageRef>();
  if (brandIds.length === 0) return out;

  const rows = await db
    .select({ brandId: products.brandId, media: mediaTable })
    .from(products)
    .innerJoin(
      productImages,
      and(eq(productImages.productId, products.id), eq(productImages.role, "primary")),
    )
    .innerJoin(mediaTable, eq(mediaTable.id, productImages.mediaId))
    .where(
      and(
        inArray(products.brandId, [...brandIds]),
        eq(products.status, "active"),
        eq(products.visibility, "public"),
        gt(products.price, 0),
        sql`(${products.stockPolicy} = 'untracked' or ${products.allowBackorder} or ${products.stockQty} >= 1)`,
      ),
    )
    .orderBy(desc(products.price), desc(products.id));

  for (const row of rows) {
    const brandId = row.brandId;
    if (brandId === null || out.has(brandId)) continue;
    const image = toImageRef(mediaRowLike(row.media), { altFallback: altByBrandId.get(brandId) ?? "" });
    if (image !== null) out.set(brandId, image);
  }
  return out;
}

/** rules: brands with products first (count desc), then the "coming soon" ones by sort. */
function compareBrands(
  a: { productCount: number; sort: number; nameEn: string },
  b: { productCount: number; sort: number; nameEn: string },
): number {
  const aEmpty = a.productCount > 0 ? 0 : 1;
  const bEmpty = b.productCount > 0 ? 0 : 1;
  if (aEmpty !== bEmpty) return aEmpty - bEmpty;
  if (aEmpty === 0 && b.productCount !== a.productCount) return b.productCount - a.productCount;
  if (a.sort !== b.sort) return a.sort - b.sort;
  return a.nameEn.localeCompare(b.nameEn, "en");
}

/** Category paths are stored decoded; a ref may arrive with stray slashes or Latin case. */
const categoryKey = (path: string): string => path.trim().replace(/^\/+|\/+$/g, "").toLowerCase();

async function loadPages(db: Db): Promise<Map<string, { title: string; slug: string }>> {
  const rows = await db
    .select({ slug: pagesTable.slug, title: pagesTable.title })
    .from(pagesTable)
    .where(eq(pagesTable.status, "published"));
  const out = new Map<string, { title: string; slug: string }>();
  for (const row of rows) out.set(row.slug.toLowerCase(), { title: row.title, slug: row.slug });
  return out;
}

const emptyMenus = (): Record<MenuKey, ResolvedMenuItem[]> => ({
  header: [],
  drawer: [],
  footer_shop: [],
  footer_help: [],
  tabbar: [],
});

export async function getNavData(db: Db): Promise<NavData> {
  // DECISION: `pages` is read here with one small SELECT instead of through content/pages.ts - 
  // its read side exposes no "every published slug + title" list, and nav must resolve a page item
  // without an N+1 of getPageBySlug. The header's dependency list allows @namilux/db.
  const [menus, brandSummaries, collectionTiles, categoryTree, pageBySlug, catalogue] = await Promise.all([
    getMenus(db),
    listBrands(db, { activeOnly: true }),
    listCollections(db),
    listCategoryTree(db),
    loadPages(db),
    catalogueCounts(db),
  ]);

  // ── brands ───────────────────────────────────────────────────────────────────────────────────
  const ordered = [...brandSummaries].sort(compareBrands);
  const needFallback = ordered.filter((b) => b.logo === null);
  const fallbackImages = await brandFallbackImages(
    db,
    needFallback.map((b) => b.id),
    new Map(needFallback.map((b) => [b.id, b.name])),
  );
  const brands: NavBrand[] = ordered.map((b) => ({
    slug: b.slug,
    name: b.name,
    nameEn: b.nameEn,
    count: b.productCount,
    // EDGE CASE: no logo and no available product → image null.
    image: b.logo ?? fallbackImages.get(b.id) ?? null,
    href: brandUrl(b.slug),
  }));
  const brandBySlug = new Map(brands.map((b) => [b.slug.toLowerCase(), b]));

  // ── collections (live only; groups carry their live subs) ────────────────────────────────────
  const childrenByParent = new Map<number, NavCollectionChild[]>();
  for (const tile of collectionTiles) {
    if (tile.kind !== "sub" || tile.parentId === null) continue;
    const list = childrenByParent.get(tile.parentId) ?? [];
    list.push({
      slug: tile.slug,
      name: tile.name,
      count: tile.productCount,
      href: collectionUrl(tile.slug),
    });
    childrenByParent.set(tile.parentId, list);
  }
  const toNavCollection = (tile: (typeof collectionTiles)[number]): NavCollection => ({
    slug: tile.slug,
    name: tile.name,
    count: tile.productCount,
    // rules: nav carries the LIGHT cover only; the component resolves the dark variant.
    image: tile.cover,
    href: collectionUrl(tile.slug),
    children: childrenByParent.get(tile.id) ?? [],
  });
  const collections = collectionTiles.filter((t) => t.kind === "group").map(toNavCollection);
  // The lookup covers every LIVE collection (campaign, gift, season, sub), not only the nav groups:
  // a menu item may point at a campaign, and it must resolve until the campaign ends.
  const collectionBySlug = new Map(
    collectionTiles.map((tile) => [tile.slug.toLowerCase(), toNavCollection(tile)]),
  );

  // ── categories (active only; hidden and archived rows have no link) ──────────────────────────
  const categoryByPath = new Map<string, { name: string; path: string; count: number }>();
  const walk = (nodes: typeof categoryTree): void => {
    for (const node of nodes) {
      if (node.status === "active") {
        categoryByPath.set(categoryKey(node.path), { name: node.name, path: node.path, count: node.count });
      }
      walk(node.children);
    }
  };
  walk(categoryTree);

  const lookups: NavLookups = {
    brandBySlug: (s) => brandBySlug.get(s.trim().toLowerCase()) ?? null,
    collectionBySlug: (s) => collectionBySlug.get(s.trim().toLowerCase()) ?? null,
    categoryByPath: (p) => categoryByPath.get(categoryKey(p)) ?? null,
    pageBySlug: (s) => pageBySlug.get(s.trim().toLowerCase()) ?? null,
  };

  const resolvedMenus = emptyMenus();
  for (const key of MENU_KEYS) {
    const items: ResolvedMenuItem[] = [];
    for (const item of menus[key]) {
      const resolved = resolveMenuItem(item, lookups);
      if (resolved !== null) items.push(resolved);
    }
    resolvedMenus[key] = items;
  }

  return {
    menus: resolvedMenus,
    brands,
    collections,
    counts: {
      products: catalogue.products,
      buyable: catalogue.buyable,
      // EDGE CASE: onSale counts sale rows regardless of availability (matches the `/discount/` total).
      onSale: catalogue.onSale,
      brands: brands.length,
    },
    generatedAt: new Date().toISOString(),
  };
}
