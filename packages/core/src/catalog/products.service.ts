import type { Db } from "@namilux/db";
import type { Actor, Crumb, ImageRef, ProductCollectionRef, SeoFields } from "../types";
import { CANONICAL_ORIGIN } from "../constants";
import { appError } from "../errors";
import { faZwnj } from "../persian";
import { sanitizeHtml } from "../html";
import { audit } from "../audit";
import { jobs } from "../jobs";
import { dedupeTags, tagsForProductChange } from "../cache/invalidation";
import type { ProductChange } from "../cache/invalidation";
import { productAdminSchema } from "../validation";
import { jsonld } from "../seo/jsonld";
import type { JsonLdCtx } from "../seo/jsonld";
import { DEFAULT_SETTINGS } from "../settings/schema";
import { categoryUrl, decPath, mediaUrl, productUrl } from "../url";
import { insertRedirect } from "../content/redirects";
import type { ProductCard } from "./cards";
import { availableQty as availableQtyOf, isShowcaseCard, toProductCard } from "./cards";
import { ogSourceKey } from "./media";
import {
  findAccessoryIds,
  findAdminRow,
  findBySlug,
  findCardSources,
  findRelatedIds,
  findSiblingIds,
  insertPriceHistory,
  listMovements,
  listPriceHistory,
  replaceAttributeValues,
  replaceCategories,
  replaceCollections,
  replaceImages,
  replaceRelations,
  replaceSpecs,
  updatePrice,
  upsertRow,
} from "./products.repo";
import { queryAdmin } from "./products.repo";
import type {
  AdminListRow,
  AdminProductFilter,
  MovementRow,
  PriceHistoryRow,
  ProductAdminRow,
  ProductFull,
  ProductSpecRow,
  ProductWriteValues,
} from "./products.repo";

export type { AdminListRow, AdminProductFilter, AdminSort } from "./products.repo";

// DECISION (M0 step 3): SpecGroup / Dims / ProductDetail / ProductAdminInput are declared once in
// ../types, and `adjustStock` is owned by ../inventory/stock.ts - that module's own header carries
// the DECISION "the spec lists adjustStock under catalog; it is implemented here (inventory owns the
// ledger) and re-exported by the catalog admin write module". This module is that re-export.
import type { Dims, ProductAdminInput, ProductDetail, SpecGroup } from "../types";
import { adjustStock } from "../inventory/stock";

export type { Dims, ProductAdminInput, ProductDetail, SpecGroup };
export { adjustStock };

export type StockView = {
  policy: "track" | "untracked";
  qty: number | null;
  maxPerOrder: number;
  allowBackorder: boolean;
};

export const RELATED_SIZE = 8;
/** Candidates fetched for the related rail before the presentation re-rank (see rules). */
export const RELATED_POOL = RELATED_SIZE * 3;
/** Photo-less cards allowed in the related rail - one is honest, a row of them is a broken grid. */
export const RELATED_PHOTOLESS_MAX = 1;

/** The related rail's presentation order: showcase → photographed → the rest; affinity order inside each. */
export function rankRelated(cards: readonly ProductCard[], size = RELATED_SIZE, photolessMax = RELATED_PHOTOLESS_MAX): ProductCard[] {
  const tier = (c: ProductCard): number => (isShowcaseCard(c) ? 0 : c.image !== undefined ? 1 : 2);
  const ranked = cards
    .map((card, index) => ({ card, index, tier: tier(card) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map((entry) => entry.card);
  const out: ProductCard[] = [];
  let photoless = 0;
  for (const card of ranked) {
    if (out.length === size) break;
    if (card.image === undefined) {
      if (photoless === photolessMax) continue;
      photoless += 1;
    }
    out.push(card);
  }
  return out;
}
export const DESCRIPTION_TEXT_MAX = 300;

export type ProductAdminView = {
  row: ProductAdminRow;
  full: ProductFull;
  priceHistory: PriceHistoryRow[];
  movements: MovementRow[];
  reservations: { orderId: string; qty: number; expiresAt: string }[];
  availableQty: number;
  siblings: ProductCard[];
};

/**
 * DECISION - the header's inline `ProductDetail` field list is superseded by ../types, which is
 * the spec §catalog line-for-line (`ProductCard & { name; shortHtml; descriptionHtml; specs; dims?;
 * warrantyMonths?; warrantyText?; categories; collections; related; accessories; siblings; video?;
 * seo; jsonld }`) and the single declaration site (src/index.ts rules: a second declaration is a
 * TS2308 build break). This is the same resolution catalog/categories.ts, catalog/brands.ts and
 * content/posts.ts already recorded for their own views. Nothing the storefront needs is lost:
 *   • `stock: StockView` → `available` / `lowStock` (booleans, cards.ts) plus `maxPerOrder` and
 *     `allowBackorder` on the detail. The exact quantity is never emitted AT ALL, which is stricter
 *     than "only when lowStock" and is exactly what the spec is protecting. `StockView` stays
 *     exported because the contract names it.
 *   • `images` → `gallery` (the canonical name; same ordered, usable ImageRef list).
 *   • `robots` → `seo.robots`; `legacyLastmod` / `updatedAt` → `seo.lastmod` (the spec rule);
 *     `publishedAt` is already a ProductCard field.
 *   • `crumbs` / `primaryCategory` → `categories`, whose first entry IS the primary one (the
 *     repository orders `is_primary` first). «خانه»/«فروشگاه» are Persian UI copy and the spec puts
 *     UI copy in apps/web/src/i18n/fa.ts, never in core.
 *   • `compareAttributes` → catalog/attributes.ts, which owns `is_comparable` (F-026).
 *
 */

/** rules: «seo.title = seo_title ?? `${displayName} - نامی لوکس`» - identical to categories/brands/posts. */
const SITE_TITLE_SUFFIX = " - نامی لوکس";
const DEFAULT_ROBOTS = "index, follow";
/** EDGE CASE: "link_only → view with robots forced to noindex, follow". */
const LINK_ONLY_ROBOTS = "noindex, follow";

/** contract of getProductCards: "max 60" (the compare/wishlist ceiling, list.ts MAX_SCOPE_IDS). */
export const CARDS_MAX = 60;

/** How much of the append-only ledgers the admin product page shows (the spec "history" panels). */
const ADMIN_HISTORY_LIMIT = 50;

/**
 * DECISION: `jsonld.product` reads only `ctx.origin` and `ctx.mediaUrl`; `siteName` and `store` feed
 * `jsonld.orgSite`, which the layout emits once per page from the LIVE settings. Spending a settings
 * round trip per PDP on fields the Product node never reads would be waste, so the ctx is assembled
 * from the pure `DEFAULT_SETTINGS` (settings/schema.ts) for those two.
 */
const jsonLdCtxFor = (origin: string): JsonLdCtx => ({
  origin,
  siteName: DEFAULT_SETTINGS["seo.defaults"].siteName,
  store: {
    ...DEFAULT_SETTINGS["store.info"],
    ...DEFAULT_SETTINGS["store.contact"],
    instagram: DEFAULT_SETTINGS["store.social"].instagram,
  },
  mediaUrl,
});

// ---------------------------------------------------------------- read side

/**
 * contract: "active, visibility public|link_only, input order, unknown skipped, max 60".
 * `now` is threaded so a PDP and every rail on it agree about «جدید» (cards.isNew).
 */
async function hydrateCards(db: Db, ids: readonly number[], now: Date): Promise<ProductCard[]> {
  const wanted: number[] = [];
  for (const id of ids) {
    // A non-integer / non-positive id is dropped rather than sent to the repository (the plan-side
    // rule of list.requireScopeIds); duplicates collapse so the cap counts distinct products.
    if (!Number.isSafeInteger(id) || id <= 0 || wanted.includes(id)) continue;
    wanted.push(id);
    // EDGE CASE: "getProductCards([...61 ids]) → first 60".
    if (wanted.length === CARDS_MAX) break;
  }
  if (wanted.length === 0) return [];
  const sources = await findCardSources(db, wanted);
  return sources
    // findCardSources only drops `archived`; draft and hidden rows are dropped here so a stale
    // wishlist/compare id can never surface a product the storefront may not show.
    .filter((s) => s.status === "active" && s.visibility !== "hidden")
    .map((s) => toProductCard(s, now));
}

export async function getProductCards(db: Db, ids: number[]): Promise<ProductCard[]> {
  return hydrateCards(db, ids, new Date());
}

/**
 * The admin products list: paginated rows with filters/sort. The public storefront query
 * (listProducts) carries the `active+public` base term; the admin must see drafts/hidden/priced rows
 * too, so this goes through the repo's admin query (queryAdmin). Archived rows are excluded unless
 * `filter.status: "archived"`.
 */
export async function listAdmin(
  db: Db,
  filter: AdminProductFilter,
): Promise<{ rows: AdminListRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.trunc(filter.page ?? 1));
  const pageSize = [50, 100, 200].includes(filter.pageSize ?? 50) ? (filter.pageSize ?? 50) : 50;
  const { rows, total } = await queryAdmin(db, { ...filter, page, pageSize });
  return { rows, total, page, pageSize };
}

/**
 * rules: "grouped by group_name preserving first-seen group order and row sort; a null group is
 * emitted as `{ name: null }` first". `rows` arrives ordered by (sort, id) from the repository.
 */
function groupSpecs(rows: readonly ProductSpecRow[]): SpecGroup[] {
  const groups: SpecGroup[] = [];
  const byName = new Map<string | null, SpecGroup>();
  for (const row of rows) {
    const raw = row.groupName?.trim() ?? "";
    const name = raw === "" ? null : raw;
    let group = byName.get(name);
    if (group === undefined) {
      group = { name, rows: [] };
      byName.set(name, group);
      groups.push(group);
    }
    group.rows.push({ label: row.label, value: row.value });
  }
  // Array#sort is stable (ES2019), so the named groups keep their first-seen order.
  return groups.sort((a, b) => (a.name === null ? 0 : 1) - (b.name === null ? 0 : 1));
}

/** `dims` is emitted only when the three measurements exist - a half-filled box is not a spec. */
function dimsOf(row: ProductFull["row"]): Dims | undefined {
  const { lengthMm, widthMm, heightMm } = row;
  if (lengthMm === null || widthMm === null || heightMm === null) return undefined;
  return { lengthMm, widthMm, heightMm, weightG: row.weightG };
}

function seoFor(row: ProductFull["row"], displayName: string, image: ImageRef | undefined): SeoFields {
  const title = row.seoTitle?.trim() ?? "";
  const description = row.seoDescription?.trim() ?? "";
  const robots = row.robots.trim();
  return {
    title: title === "" ? `${displayName}${SITE_TITLE_SUFFIX}` : title,
    // the spec: "86 missing descriptions stay missing until Phase 2" - never invented here.
    description: description === "" ? null : description,
    robots:
      row.visibility === "link_only" ? LINK_ONLY_ROBOTS : robots === "" ? DEFAULT_ROBOTS : robots,
    // rules: "canonicalPath = /product/<slug>/ (decoded - the page encodes via productUrl)".
    // Minted through ../url and decoded back, so no path is built by hand.
    canonical: decPath(productUrl(row.slug)),
    // DECISION: seo/og.ts exports neither `ogImagePath` nor `SITE_OG_PATH` (it has ogKeyFor /
    // ensureOg / ogUrl, all unbuilt at the time and throwing), so the product's own first-party, content
    // hashed master key stands in for the generated card and `null` means the site default, which
    // seo/metadata.buildMetadata already owns as `defaultOgKey`. Identical to the resolution
    // catalog/brands.ts and catalog/collections.ts recorded. Swap for `ogKeyFor({ kind: "product",
    // id })` when og.ts lands.
    ogImage: image === undefined ? null : ogSourceKey(image),
    // the spec: lastmod = legacy_lastmod until the entity is edited after launch, then updated_at.
    lastmod: row.legacyLastmod ?? row.updatedAt,
  };
}

export async function getProductBySlug(
  db: Db,
  slug: string,
  ctx?: { origin?: string; now?: Date },
): Promise<ProductDetail | null> {
  const now = ctx?.now ?? new Date();
  const origin = ctx?.origin ?? CANONICAL_ORIGIN;
  const wanted = slug.trim();
  if (wanted === "") return null;

  const full = await findBySlug(db, wanted);
  if (full === null) return null;
  const row = full.row;
  // rules / the spec: "active|link_only; archived → null (the router consults redirects)". A draft or
  // hidden row is a 404 too - only `link_only` is reachable by URL without being listed.
  if (row.status !== "active" || row.visibility === "hidden") return null;

  const [cardSources, relatedIds, accessoryIds] = await Promise.all([
    // The card is hydrated through the same path the grid uses so badges, variant swatches and the
    // image fallback chain exist in exactly one place (cards.ts), never twice.
    findCardSources(db, [row.id]),
    findRelatedIds(db, row.id, RELATED_POOL),
    findAccessoryIds(db, row.id),
  ]);
  const source = cardSources[0];
  // Unreachable in practice (findBySlug already matched a non-archived row); a race that archives
  // the product between the two reads is a 404, never a half-built page.
  if (source === undefined) return null;
  const card = toProductCard(source, now);

  // rules: three rails, ONE round trip - never N+1 (products.repo rules).
  const railIds: number[] = [];
  for (const id of [...relatedIds, ...accessoryIds, ...full.siblingIds]) {
    if (id !== row.id && !railIds.includes(id)) railIds.push(id);
  }
  const railCards = await hydrateCards(db, railIds, now);
  const byId = new Map(railCards.map((c) => [c.id, c]));
  const rail = (ids: readonly number[]): ProductCard[] =>
    ids.flatMap((id) => {
      const found = byId.get(id);
      return found === undefined ? [] : [found];
    });

  // The admin's ordered attachments are authoritative. A manufacturer image must not hide
  // the other angles the admin explicitly added to this product.
  const gallery = full.images.map((image) => image.media);
  const video = full.video;

  const detail: Omit<ProductDetail, "jsonld"> = {
    ...card,
    name: row.name,
    sku: row.sku,
    // rules / the spec: re-sanitized at read (defence in depth); sanitizeHtml is idempotent.
    shortHtml: sanitizeHtml(row.shortHtml),
    descriptionHtml: sanitizeHtml(row.descriptionHtml),
    specs: groupSpecs(full.specs),
    ...(dimsOf(row) === undefined ? {} : { dims: dimsOf(row) as Dims }),
    ...(row.warrantyMonths === null ? {} : { warrantyMonths: row.warrantyMonths }),
    ...(row.warrantyText.trim() === "" ? {} : { warrantyText: row.warrantyText.trim() }),
    // rules: "the product's non-archived categories as crumbs"; the repository orders the primary
    // one first, so `categories[0]` is the `primaryCategory` of the header's field list.
    categories: full.categories
      .filter((c) => c.status !== "archived" && c.path.trim() !== "")
      .map((c): Crumb => ({ name: c.name, href: categoryUrl(c.path) })),
    // DECISION: only LIVE memberships become PDP chips - a chip pointing at an expired campaign
    // would link to a page getCollectionBySlug answers with null (a 404 out of our own markup).
    collections: full.collections
      .filter((c) => c.live)
      .map((c): ProductCollectionRef => ({ slug: c.slug, name: c.name, kind: c.kind })),
    related: rankRelated(rail(relatedIds)),
    accessories: rail(accessoryIds),
    siblings: rail(full.siblingIds),
    gallery,
    ...(video === null || video.kind !== "video"
      ? {}
      : {
          video: {
            // The canonical type carries the storage KEY (the page mints the URL through ../url),
            // not the built src of media.toVideoRef.
            key: video.storageKey,
            poster: gallery[0] ?? null,
            durationMs: video.durationMs,
          },
        }),
    maxPerOrder: row.maxPerOrder,
    allowBackorder: row.allowBackorder,
    status: row.status,
    visibility: row.visibility,
    seo: seoFor(row, card.displayName, card.image),
  };

  return {
    ...detail,
    // rules: "Product + Offer only when price > 0 + AggregateRating only when ratingCount ≥ 3
    //" - both rules live inside jsonld.product; this call site only supplies the facts.
    jsonld: jsonld.product(
      { ...detail, jsonld: {} },
      {
        path: detail.seo.canonical,
        rating:
          card.rating === undefined
            ? null
            : { ratingValue: card.rating.avg, reviewCount: card.rating.count },
      },
      jsonLdCtxFor(origin),
    ),
  };
}

export async function getProductAdmin(db: Db, id: number): Promise<ProductAdminView | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const row = await findAdminRow(db, id);
  if (row === null) return null;

  const now = new Date();
  const [full, priceHistory, movements, siblingIds] = await Promise.all([
    // The admin edits archived rows too, so the satellite read must include them.
    findBySlug(db, row.slug, { includeArchived: true }),
    listPriceHistory(db, id, ADMIN_HISTORY_LIMIT),
    listMovements(db, id, ADMIN_HISTORY_LIMIT),
    row.modelId === null ? Promise.resolve<number[]>([]) : findSiblingIds(db, row.modelId, id),
  ]);
  if (full === null) return null;

  return {
    row,
    full,
    priceHistory,
    movements,
    // DECISION: the per-product reservation rows are NOT queried here. `packages/core` keeps SQL in
    // `*/repo.ts` and neither catalog/products.repo.ts nor inventory/repo.ts exposes a
    // "reservations of product X" read (inventory/repo has listOrderReservations, keyed by order),
    // so writing the statement here would breach the boundary. Reported to the architect: the
    // helper belongs in inventory/repo.ts. The aggregate the panel needs to be CORRECT - 
    // `availableQty` - is derived below from the repository's own reserved sum, so nothing is
    // silently wrong; the table is only empty.
    reservations: [],
    availableQty: availableQtyOf({
      stockPolicy: row.stockPolicy,
      stockQty: row.stockQty,
      reservedQty: full.reservedQty,
      allowBackorder: row.allowBackorder,
      lowStockThreshold: row.lowStockThreshold,
      maxPerOrder: row.maxPerOrder,
    }),
    siblings: await hydrateCards(db, siblingIds, now),
  };
}

// ---------------------------------------------------------------- write side

/**
 * rules: "integer Toman, price ≥ 0, compareAt null or > price (else VALIDATION)".
 * Mirrors `validation/catalog-admin.saleRule` (`compareAt == null || (price > 0 && compareAt > price)`)
 * so an on-request row can never carry a "was" price.
 */
function assertPriceValues(price: number, compareAt: number | null): void {
  if (!Number.isSafeInteger(price) || price < 0) {
    throw appError("VALIDATION", { details: { field: "price", value: price } });
  }
  if (compareAt === null) return;
  if (!Number.isSafeInteger(compareAt) || !(price > 0 && compareAt > price)) {
    throw appError("VALIDATION", { details: { field: "compareAt", value: compareAt } });
  }
}

/**
 * DECISION: the instalment rule is READ HERE rather than added to the signature. Every caller of
 * this function is a route or an importer that already holds `db` and none of them holds settings,
 * so widening the signature would only push the same `getSettings` call up one frame; the loader is
 * memoised per process (settings/service), so this costs nothing on the hot path.
 */


export async function setPrice(
  db: Db,
  id: number,
  price: number,
  compareAt: number | null,
  actor: Actor,
  note?: string,
): Promise<void> {
  // The pure rules run first: an invalid body never costs a round trip.
  assertPriceValues(price, compareAt);

  const before = await findAdminRow(db, id);
  if (before === null) throw appError("NOT_FOUND", { details: { productId: id } });
  // rules: "rows with price_basis fx → CONFLICT" (their price is owned by the fx job, the spec).
  if (before.priceBasis === "fx") {
    throw appError("CONFLICT", { details: { productId: id, reason: "price_basis_fx" } });
  }
  // EDGE CASE: "same values → no history row" - and no audit row either; nothing happened.
  if (before.price === price && before.compareAtPrice === compareAt) return;

  const noteValue = note?.trim() === "" ? null : (note ?? null);
  await db.transaction(async (tx) => {
    await updatePrice(tx, id, price, compareAt);
    await insertPriceHistory(tx, {
      productId: id,
      price,
      compareAtPrice: compareAt,
      actor,
      note: noteValue,
    });
    await audit.log(
      tx,
      actor,
      "product.price.update",
      "products",
      String(id),
      { price: before.price, compareAtPrice: before.compareAtPrice },
      { price, compareAtPrice: compareAt, note: noteValue },
    );
  });
}

/** The admin form posts the whole row; an ABSENT key is a form field, `null` is a cleared value. */
const orNull = <T>(value: T | null | undefined): T | null => value ?? null;

function writeValuesFor(
  p: ProductAdminInput,
  before: ProductAdminRow | null,
  text: { name: string; displayName: string; colorName: string | null; shortHtml: string; descriptionHtml: string },
): ProductWriteValues {
  // A pinned row keeps exactly what the form typed (an empty box is 0 = on request, like price 0);
  // an unpinned one is always the derived value, so unticking the box repairs a stale override even
  // when the fixed price itself did not move.
  // Retired second-site prices are retained only for historical compatibility.
  return {
    instalmentPriceManual: before?.instalmentPriceManual ?? false,
    instalmentPrice: before?.instalmentPrice ?? null,
    // Same absent-key rule as `costPrice` below: a form that does not carry the switch preserves it,
    // and a brand-new product is eligible unless the form says otherwise.
    instalmentEligible: p.instalmentEligible ?? before?.instalmentEligible ?? true,
    ...(p.id === undefined ? {} : { id: p.id }),
    slug: p.slug,
    name: text.name,
    displayName: text.displayName,
    brandId: orNull(p.brandId),
    modelId: orNull(p.modelId),
    sku: orNull(p.sku),
    modelCode: orNull(p.modelCode),
    colorName: text.colorName,
    colorHex: orNull(p.colorHex),
    swatchMediaId: orNull(p.swatchMediaId),
    status: p.status,
    visibility: p.visibility,
    // DECISION (owner/admin split): `cost_price` is an OWNER-ONLY field, so an admin's form never
    // carries the key at all - and an ABSENT key must preserve the stored cost, exactly as
    // `publishedAt` below does, or every ordinary product edit by an admin would silently wipe the
    // margin. `null` is still a cleared value, which is what the owner's emptied box sends.
    costPrice: p.costPrice === undefined ? (before?.costPrice ?? null) : p.costPrice,
    priceBasis: p.priceBasis,
    basePrice: orNull(p.basePrice),
    baseCurrency: orNull(p.baseCurrency),
    stockPolicy: p.stockPolicy,
    allowBackorder: p.allowBackorder,
    lowStockThreshold: p.lowStockThreshold,
    maxPerOrder: p.maxPerOrder,
    shortHtml: text.shortHtml,
    descriptionHtml: text.descriptionHtml,
    warrantyMonths: orNull(p.warrantyMonths),
    warrantyText: p.warrantyText?.trim() ?? "",
    weightG: orNull(p.weightG),
    lengthMm: orNull(p.lengthMm),
    widthMm: orNull(p.widthMm),
    heightMm: orNull(p.heightMm),
    videoMediaId: orNull(p.videoMediaId),
    seoTitle: orNull(p.seoTitle),
    seoDescription: orNull(p.seoDescription),
    robots: p.robots?.trim() === "" ? DEFAULT_ROBOTS : (p.robots ?? before?.robots ?? DEFAULT_ROBOTS),
    // DECISION: `legacy_lastmod` and `published_at` are NOT admin form fields (productAdminSchema
    // has no legacyLastmod at all and makes publishedAt optional), so an absent key preserves the
    // stored value instead of clearing it - both drive the sitemap dates of the spec and the «جدید»
    // badge, and losing them on an unrelated edit would be an SEO regression.
    legacyLastmod: before?.legacyLastmod ?? null,
    publishedAt: p.publishedAt === undefined ? (before?.publishedAt ?? null) : p.publishedAt,
  };
}

/** rules: the audit diff excludes the html bodies (they are large and never the interesting part). */
function auditSnapshot(values: ProductWriteValues): Record<string, unknown> {
  const { shortHtml: _short, descriptionHtml: _description, ...rest } = values;
  return { ...rest };
}

function snapshotOf(row: ProductAdminRow): Record<string, unknown> {
  const { shortHtml: _short, descriptionHtml: _description, ...rest } = row;
  return { ...rest };
}

export async function upsertProduct(
  db: Db,
  input: ProductAdminInput,
  actor: Actor,
): Promise<{ id: number; tags: string[] }> {
  // rules: "validates with productAdminSchema (strict)" - re-parsed even though the parameter is
  // already typed, because the only caller is an HTTP handler and the type is a compile-time claim.
  const parsed = productAdminSchema.safeParse(input);
  if (!parsed.success) throw appError("VALIDATION", { details: parsed.error.issues });
  const p = parsed.data;

  const text = {
    name: faZwnj(p.name),
    displayName: faZwnj(p.displayName),
    colorName: p.colorName == null ? null : faZwnj(p.colorName),
    shortHtml: sanitizeHtml(p.shortHtml),
    descriptionHtml: sanitizeHtml(p.descriptionHtml),
  };

  const before = p.id === undefined ? null : await findAdminRow(db, p.id);
  if (p.id !== undefined && before === null) throw appError("NOT_FOUND", { details: { id: p.id } });

  const slugChanged = before !== null && before.slug !== p.slug;
  // rules: "refuses slug change on legacy ids (CONFLICT)".
  // DECISION: "legacy" is read off the row, not off an id ceiling: a legacy product is exactly one
  // the seed gave a `legacy_lastmod` (it appeared in the spec crawl), so its URL is one of the 752
  // the contract check protects. content/posts.ts derives the same fact as `max(id) where
  // legacy_lastmod is not null`; the per-row test is the identical predicate without the extra
  // query, and it stays correct if a legacy id is ever re-used.
  if (slugChanged && before.legacyLastmod !== null) {
    throw appError("CONFLICT", {
      details: { field: "slug", reason: "legacy_slug_immutable", id: before.id },
    });
  }

  // DECISION: the model KEY is not recomputed here. rules ask for `models.modelKey` when the
  // display name changed, but no repository can persist it - products.repo.ts writes `products`
  // and its satellites only, and `product_models` has no write helper anywhere in the package
  // (models.groupModels / models.setModel own that table, and both are unbuilt at the time). Calling
  // modelKey and discarding the result would be theatre. Reported to the architect: the helper
  // (`updateModelKey`) belongs in a models repository.

  const values = writeValuesFor(p, before, text);
  const priceChanged = before === null || before.price !== p.price || before.compareAtPrice !== orNull(p.compareAtPrice);

  const id = await db.transaction(async (tx) => {
    // rules: "replaces satellites in ONE transaction".
    const written = await upsertRow(tx, values);
    const productId = written.id;
    await replaceCategories(
      tx,
      productId,
      p.categoryIds.map((c) => ({ categoryId: c.id, isPrimary: c.isPrimary })),
    );
    await replaceImages(tx, productId, p.images);
    await replaceSpecs(
      tx,
      productId,
      p.specs.map((s) => ({ groupName: orNull(s.groupName), label: s.label, value: s.value, sort: s.sort })),
    );
    await replaceAttributeValues(
      tx,
      productId,
      p.attributes.map((a) => ({
        attributeId: a.attributeId,
        valueText: orNull(a.valueText),
        valueNum: orNull(a.valueNum),
      })),
    );
    await replaceRelations(tx, productId, p.relations);
    await replaceCollections(tx, productId, p.collectionIds);

    // DECISION: the price is written through updatePrice + insertPriceHistory inside the SAME
    // transaction rather than by upsertRow, because products.repo rules forbid upsertRow from
    // touching price so that `price_history` "can never be bypassed". Without this a
    // newly created product would silently be priced 0 (= on request).
    if (priceChanged) {
      await updatePrice(tx, productId, p.price, orNull(p.compareAtPrice));
      await insertPriceHistory(tx, {
        productId,
        price: p.price,
        compareAtPrice: orNull(p.compareAtPrice),
        actor,
        note: null,
      });
    }

    // rules: "creates a `redirects` row for slug changes on new ids" (the spec - every URL that ever
    // served 200 keeps working). Same source ("manual") content/posts.ts uses for a slug change.
    if (slugChanged) {
      await insertRedirect(
        tx,
        {
          fromPath: decPath(productUrl(before.slug)),
          toPath: decPath(productUrl(p.slug)),
          code: 301,
          source: "manual",
        },
        actor,
      );
    }

    await audit.log(
      tx,
      actor,
      before === null ? "product.create" : "product.update",
      "products",
      String(productId),
      before === null ? undefined : snapshotOf(before),
      auditSnapshot(values),
    );
    return productId;
  });

  // rules: "enqueues `og.generate` when the primary image or displayName changed".
  // DECISION: enqueued on every successful save. Deciding "the primary image changed" needs the
  // BEFORE image rows, which findAdminRow does not carry and which would cost a second satellite
  // read on every save; `uniqueKey` collapses repeats into one queued job (jobs rules), so the
  // superset is free. The displayName case is always covered by it.
  await jobs.enqueue(db, "og.generate", { kind: "product", id }, { uniqueKey: `og:product:${id}` });

  // rules: "returns tags = tagsForProductChange(...)". One save can touch several dimensions and
  // the spec prefers over-invalidation to staleness, so the union of the changes this write
  // could have made is returned (deduped + sorted by dedupeTags).
  const changes: ProductChange[] = ["content", "images", "seo", "relations"];
  if (priceChanged) changes.push("price");
  if (before === null || before.status !== p.status || before.visibility !== p.visibility) {
    changes.push("status");
  }
  const target = {
    id,
    categoryIds: p.categoryIds.map((c) => c.id),
    brandId: orNull(p.brandId),
    collectionIds: p.collectionIds,
  };
  return { id, tags: dedupeTags(changes.flatMap((change) => tagsForProductChange(target, change))) };
}
