import {
  and,
  asc,
  brands,
  categories,
  collections,
  eq,
  gt,
  isNull,
  lte,
  media,
  or,
  pages,
  posts,
  productImages,
  products,
  sql,
} from "@namilux/db";
import type { Db, SQL } from "@namilux/db";
import { SITEMAP_NAMES } from "../constants";
import type { SitemapName } from "../constants";
import type { SitemapEntry, SitemapIndexEntry } from "../types";
import { appError } from "../errors";
import {
  ROUTES,
  absUrl,
  brandUrl,
  categoryUrl,
  collectionUrl,
  mediaUrl,
  pageUrl,
  postUrl,
  productUrl,
} from "../url";

// ---------------------------------------------------------------- constants

export const SITEMAP_CHILDREN: readonly SitemapName[] = SITEMAP_NAMES;

export const PRODUCTS_PER_CHILD = 200;

/**
 * the spec - the storefront's robots.txt disallow list.
 *
 * DECISION: the nine paths are exported from here rather than inlined twice, because
 * `apps/web/src/app/robots.ts` (the Next metadata route) and `robotsTxt` below must render the same
 * list; one array is what stops the storefront and the admin-host variant from drifting apart.
 */
export const ROBOTS_DISALLOW = [
  "/cart/",
  "/billing/",
  "/compare/",
  "/wishlist/",
  "/track/",
  "/account/",
  "/api/",
  "/search/",
  "/ig/",
] as const;

/**
 * The sitemaps protocol caps a child at 50 000 URLs. It is the ceiling of the LAST product child,
 * which is deliberately unbounded (see `productRange`), so a catalogue that grows past 600 items
 * can never be silently truncated by the fixed three-file split.
 */
const MAX_URLS_PER_CHILD = 50_000;

/** The three product children, in index order. */
const PRODUCT_CHILDREN: readonly SitemapName[] = [
  "product-sitemap1.xml",
  "product-sitemap2.xml",
  "product-sitemap3.xml",
];

/**
 * DECISION: `lastmodFor` needs the cutover instant, but `buildSitemap`'s contract ctx is
 * `{ origin }` and no `site.launchedAt` setting or env var exists yet (settings/schema.ts has no
 * such key). `ctx.launchAt` is therefore an OPTIONAL extra - every caller that passes only
 * `{ origin }` still type-checks - and this constant is the fallback. It is a fixed instant, never
 * `Date.now()`: before cutover every seeded row keeps its legacy lastmod, after cutover only the
 * rows a human actually edited move.
 */
const LAUNCH_AT = "2026-09-01T00:00:00.000Z";

/**
 * A robots directive list is "indexable" unless it contains `noindex` or `none`. Matched in SQL so
 * the product LIMIT/OFFSET split counts only the rows that are actually listed.
 */
const NOINDEX_PATTERN = "(^|[,[:space:]])(noindex|none)([,[:space:]]|$)";

type RobotsColumn =
  | typeof products.robots
  | typeof categories.robots
  | typeof brands.robots
  | typeof posts.robots
  | typeof pages.robots;

const indexable = (column: RobotsColumn): SQL => sql`${column} !~* ${NOINDEX_PATTERN}`;

/**
 * Static routes that the spec marks indexable and that therefore belong in the sitemap even though no
 * row backs them.
 *
 * DECISION: `/` and `/shop/` were in the legacy `page-sitemap.xml` and `/blog/` in the legacy
 * `post-sitemap.xml`; their `pages` rows are archived by the seed because a real route serves them,
 * so filtering entities alone would drop the homepage out of the sitemap - indefensible for the one
 * module whose purpose is ranking continuity. They carry `lastmod: null` (the element is omitted)
 * instead of an invented date, which keeps rules "never stamp the build date" intact.
 */
const STATIC_PAGE_ROUTES: readonly string[] = [
  ROUTES.home,
  ROUTES.shop,
  ROUTES.discount,
  ROUTES.new,
  ROUTES.gifts,
];
const STATIC_POST_ROUTES: readonly string[] = [ROUTES.blog];

// ---------------------------------------------------------------- lastmod

const parseInstant = (value: string | null | undefined): number | null => {
  if (typeof value !== "string" || value.trim() === "") return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
};

const isoOf = (at: number): string => new Date(at).toISOString();

export function lastmodFor(e: {
  legacyLastmod: string | null;
  updatedAt: string;
  publishedAt: string | null;
  launchAt: string;
}): string {
  const updated = parseInstant(e.updatedAt);
  const launch = parseInstant(e.launchAt);
  const legacy = parseInstant(e.legacyLastmod);
  const published = parseInstant(e.publishedAt);

  // Edited after launch → the edit date; otherwise the date the old site published, then
  // published_at for entities that never had a legacy URL.
  if (updated !== null && launch !== null && updated > launch) return isoOf(updated);
  if (legacy !== null) return isoOf(legacy);
  if (published !== null) return isoOf(published);
  if (updated !== null) return isoOf(updated);
  if (launch !== null) return isoOf(launch);
  // DECISION: edge cases forbid emitting "Invalid Date", and substituting `now` would be exactly the
  // mass-edit signal rules bans - so a row with no parsable date at all is a caller bug and throws.
  throw appError("VALIDATION", { details: { reason: "lastmod_unparsable" } });
}

type DatedRow = { legacyLastmod: Date | null; publishedAt: Date | null; updatedAt: Date };

/**
 * DECISION: a legacy row can hold a timestamp JavaScript cannot represent - product 54256 carries
 * `published_at = 1404-08-04 10:22:00+03:25:44` (a Jalali year with an LMT offset), which the
 * driver hands over as an Invalid Date. `toISOString()` would throw RangeError and take the whole
 * sitemap down, so an unrepresentable instant degrades to null and `lastmodFor` moves to the next
 * candidate (edge cases: never "Invalid Date").
 */
const iso = (d: Date | null): string | null =>
  d === null || Number.isNaN(d.getTime()) ? null : d.toISOString();

const rowLastmod = (row: DatedRow, launchAt: string): string =>
  lastmodFor({
    legacyLastmod: iso(row.legacyLastmod),
    publishedAt: iso(row.publishedAt),
    updatedAt: iso(row.updatedAt) ?? "",
    launchAt,
  });

// ---------------------------------------------------------------- children

type BuildCtx = { origin: string; launchAt?: string };

const staticEntries = (origin: string, paths: readonly string[]): SitemapEntry[] =>
  paths.map((path) => ({ loc: absUrl(origin, path), lastmod: null }));

/**
 * A storage key the media pipeline would reject must never abort a whole sitemap: the image is
 * dropped and the URL is still listed.
 */
function imageAbs(origin: string, storageKey: string | null): string[] | undefined {
  if (storageKey === null || storageKey === "") return undefined;
  try {
    return [absUrl(origin, mediaUrl(storageKey))];
  } catch {
    return undefined;
  }
}

/** `offset`/`limit` of a product child; the last child is unbounded (see MAX_URLS_PER_CHILD). */
function productRange(index: number): { offset: number; limit: number } {
  const isLast = index === PRODUCT_CHILDREN.length - 1;
  return {
    offset: index * PRODUCTS_PER_CHILD,
    limit: isLast ? MAX_URLS_PER_CHILD : PRODUCTS_PER_CHILD,
  };
}

async function buildProducts(db: Db, index: number, ctx: BuildCtx): Promise<SitemapEntry[]> {
  const launchAt = ctx.launchAt ?? LAUNCH_AT;
  const { offset, limit } = productRange(index);
  const rows = await db
    .select({
      slug: products.slug,
      legacyLastmod: products.legacyLastmod,
      publishedAt: products.publishedAt,
      updatedAt: products.updatedAt,
      storageKey: media.storageKey,
    })
    .from(products)
    // `product_images_primary_uq` allows at most one primary image per product, so this join cannot
    // multiply rows and break the LIMIT/OFFSET split.
    .leftJoin(productImages, and(eq(productImages.productId, products.id), eq(productImages.role, "primary")))
    .leftJoin(media, eq(media.id, productImages.mediaId))
    .where(
      and(
        eq(products.status, "active"),
        // `hidden` and `link_only` products are reachable but are not canonical listings.
        eq(products.visibility, "public"),
        indexable(products.robots),
      ),
    )
    .orderBy(asc(products.id))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => {
    const images = imageAbs(ctx.origin, row.storageKey);
    const entry: SitemapEntry = {
      loc: absUrl(ctx.origin, productUrl(row.slug)),
      lastmod: rowLastmod(row, launchAt),
    };
    return images === undefined ? entry : { ...entry, images };
  });
}

async function buildPosts(db: Db, ctx: BuildCtx): Promise<SitemapEntry[]> {
  const launchAt = ctx.launchAt ?? LAUNCH_AT;
  const now = new Date();
  const rows = await db
    .select({
      slug: posts.slug,
      legacyLastmod: posts.legacyLastmod,
      publishedAt: posts.publishedAt,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .where(
      and(
        eq(posts.status, "published"),
        // A scheduled post is not a 200 yet. A NULL published_at counts as live - the same reading
        // content/redirects.resolveRootSlug uses, so the router and the sitemap agree.
        or(isNull(posts.publishedAt), lte(posts.publishedAt, now)),
        indexable(posts.robots),
      ),
    )
    .orderBy(asc(posts.id));

  return [
    ...staticEntries(ctx.origin, STATIC_POST_ROUTES),
    ...rows.map((row) => ({ loc: absUrl(ctx.origin, postUrl(row.slug)), lastmod: rowLastmod(row, launchAt) })),
  ];
}

async function buildPages(db: Db, ctx: BuildCtx): Promise<SitemapEntry[]> {
  const launchAt = ctx.launchAt ?? LAUNCH_AT;
  const rows = await db
    .select({
      slug: pages.slug,
      legacyLastmod: pages.legacyLastmod,
      updatedAt: pages.updatedAt,
    })
    .from(pages)
    // rules: privacy/terms templates ARE included; only draft/archived and noindex rows drop out.
    .where(and(eq(pages.status, "published"), indexable(pages.robots)))
    .orderBy(asc(pages.id));

  return [
    ...staticEntries(ctx.origin, STATIC_PAGE_ROUTES),
    ...rows.map((row) => ({
      loc: absUrl(ctx.origin, pageUrl(row.slug)),
      lastmod: rowLastmod({ ...row, publishedAt: null }, launchAt),
    })),
  ];
}

async function buildCategories(db: Db, ctx: BuildCtx): Promise<SitemapEntry[]> {
  const launchAt = ctx.launchAt ?? LAUNCH_AT;
  const rows = await db
    .select({
      path: categories.path,
      legacyLastmod: categories.legacyLastmod,
      updatedAt: categories.updatedAt,
    })
    .from(categories)
    .where(
      and(
        // `archived` covers `/category/محصولات-اسمگ/`, a 301 to /brand/smeg/ that must never be
        // listed (rules); `hidden` is not a canonical 200 either.
        eq(categories.status, "active"),
        eq(categories.inSitemap, true),
        indexable(categories.robots),
      ),
    )
    .orderBy(asc(categories.path));

  return rows.map((row) => ({
    loc: absUrl(ctx.origin, categoryUrl(row.path)),
    lastmod: rowLastmod({ ...row, publishedAt: null }, launchAt),
  }));
}

async function buildBrands(db: Db, ctx: BuildCtx): Promise<SitemapEntry[]> {
  const launchAt = ctx.launchAt ?? LAUNCH_AT;
  const rows = await db
    .select({
      slug: brands.slug,
      legacyLastmod: brands.legacyLastmod,
      updatedAt: brands.updatedAt,
    })
    .from(brands)
    .where(and(eq(brands.isActive, true), indexable(brands.robots)))
    .orderBy(asc(brands.sort), asc(brands.id));

  return rows.map((row) => ({
    loc: absUrl(ctx.origin, brandUrl(row.slug)),
    lastmod: rowLastmod({ ...row, publishedAt: null }, launchAt),
  }));
}

async function buildCollections(db: Db, ctx: BuildCtx): Promise<SitemapEntry[]> {
  const launchAt = ctx.launchAt ?? LAUNCH_AT;
  const now = new Date();
  const rows = await db
    .select({
      slug: collections.slug,
      createdAt: collections.createdAt,
      updatedAt: collections.updatedAt,
    })
    .from(collections)
    .where(
      and(
        eq(collections.status, "active"),
        // A campaign collection outside its window is not a live 200 URL.
        or(isNull(collections.startsAt), lte(collections.startsAt, now)),
        or(isNull(collections.endsAt), gt(collections.endsAt, now)),
      ),
    )
    .orderBy(asc(collections.sort), asc(collections.id));

  return rows.map((row) => ({
    loc: absUrl(ctx.origin, collectionUrl(row.slug)),
    // DECISION: collections never existed on the old site, so they have neither legacy_lastmod nor a
    // published_at column - `created_at` is the "new entities: published_at" date of the spec
    lastmod: rowLastmod({ legacyLastmod: null, publishedAt: row.createdAt, updatedAt: row.updatedAt }, launchAt),
  }));
}

export async function buildSitemap(db: Db, name: SitemapName, ctx: BuildCtx): Promise<SitemapEntry[]> {
  switch (name) {
    case "product-sitemap1.xml":
    case "product-sitemap2.xml":
    case "product-sitemap3.xml":
      return buildProducts(db, PRODUCT_CHILDREN.indexOf(name), ctx);
    case "post-sitemap.xml":
      return buildPosts(db, ctx);
    case "page-sitemap.xml":
      return buildPages(db, ctx);
    case "product_cat-sitemap.xml":
      return buildCategories(db, ctx);
    case "pa_brand-sitemap.xml":
      return buildBrands(db, ctx);
    case "collection-sitemap.xml":
      return buildCollections(db, ctx);
    case "category-sitemap.xml":
      // DECISION: the legacy `category-sitemap.xml` (WordPress POST categories) held exactly one
      // URL, `/category/بلاگ/`, which rules turn into a 301 to /blog/ - and this build has no blog
      // taxonomy. The child stays in SITEMAP_CHILDREN so the URL Google already knows keeps
      // answering 200 with zero <url> elements (edge cases: an empty child is served and listed).
      return [];
    default:
      throw appError("NOT_FOUND", { details: { sitemap: name } });
  }
}

// ---------------------------------------------------------------- index

/** Newest of a list of ISO instants - string compare is safe, they are all UTC `toISOString()`. */
function newestOf(values: readonly (string | null)[]): string | null {
  let max: string | null = null;
  for (const value of values) {
    if (value !== null && (max === null || value > max)) max = value;
  }
  return max;
}

export async function sitemapIndex(db: Db, ctx: BuildCtx): Promise<SitemapIndexEntry[]> {
  const children: { name: SitemapName; lastmod: string | null }[] = [];
  // Sequential: the storefront pool is small and this route is cached behind the "sitemap" tag.
  for (const name of SITEMAP_CHILDREN) {
    const entries = await buildSitemap(db, name, ctx);
    children.push({ name, lastmod: newestOf(entries.map((entry) => entry.lastmod)) });
  }

  // DECISION: SitemapIndexEntry.lastmod is non-nullable, but an empty child (or one built only from
  // static routes) has no date of its own. It inherits the newest date in the whole index - a real
  // stored date, never the build date - and falls back to the launch instant only when the database
  // is completely empty.
  const fallback = newestOf(children.map((child) => child.lastmod)) ?? isoOf(parseInstant(ctx.launchAt ?? LAUNCH_AT) ?? 0);

  return children.map((child) => ({ name: child.name, lastmod: child.lastmod ?? fallback }));
}

// ---------------------------------------------------------------- rendering

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

const XML_ESCAPE_RE = /[&<>"']/g;

/**
 * C0 controls other than tab/LF/CR cannot be represented in XML 1.0 at all, so a slug carrying one
 * would produce a document no parser accepts. Written as a code-point filter rather than a regex
 * character class.
 */
function stripXmlIllegal(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    // 9 tab, 10 line feed, 13 carriage return are the only C0 codes XML 1.0 allows.
    if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) continue;
    out += ch;
  }
  return out;
}

const xmlEscape = (value: string): string =>
  stripXmlIllegal(value).replace(XML_ESCAPE_RE, (ch) => XML_ESCAPES[ch] ?? ch);

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const IMAGE_NS = "http://www.google.com/schemas/sitemap-image/1.1";

export function renderSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries.map((entry) => {
    const lastmod = entry.lastmod === null ? "" : `<lastmod>${xmlEscape(entry.lastmod)}</lastmod>`;
    const images = (entry.images ?? [])
      .map((src) => `<image:image><image:loc>${xmlEscape(src)}</image:loc></image:image>`)
      .join("");
    return `  <url><loc>${xmlEscape(entry.loc)}</loc>${lastmod}${images}</url>`;
  });
  return [XML_DECLARATION, `<urlset xmlns="${SITEMAP_NS}" xmlns:image="${IMAGE_NS}">`, ...urls, "</urlset>", ""].join(
    "\n",
  );
}

export function renderIndexXml(entries: SitemapIndexEntry[], origin: string): string {
  const children = entries.map((entry) => {
    // The children keep the ROOT paths Google already crawls (`/post-sitemap.xml`); apps/web
    // rewrites them onto `/sitemaps/<name>` internally.
    const loc = xmlEscape(absUrl(origin, `/${entry.name}`));
    return `  <sitemap><loc>${loc}</loc><lastmod>${xmlEscape(entry.lastmod)}</lastmod></sitemap>`;
  });
  return [XML_DECLARATION, `<sitemapindex xmlns="${SITEMAP_NS}">`, ...children, "</sitemapindex>", ""].join("\n");
}

export function robotsTxt(ctx: { origin: string; isAdminHost: boolean }): string {
  // The admin hostname is never indexed; proxy.ts adds X-Robots-Tag: noindex on top.
  if (ctx.isAdminHost) return "User-agent: *\nDisallow: /";
  const disallow = ROBOTS_DISALLOW.map((path) => `Disallow: ${path}`).join("\n");
  return `User-agent: *\n${disallow}\n\nSitemap: ${absUrl(ctx.origin, ROUTES.sitemapIndex)}`;
}
