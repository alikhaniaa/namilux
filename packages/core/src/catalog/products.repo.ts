import {
  type Db,
  type SQL,
  and,
  asc,
  attributes,
  brands,
  categories as categoriesTable,
  collectionProducts,
  collections,
  desc,
  eq,
  inArray,
  inventoryMovements,
  inventoryReservations,
  media,
  metricsDaily,
  ne,
  priceHistory,
  productAttributeValues,
  productCategories,
  productImages,
  productRelations,
  productSpecs,
  products,
  sql,
} from "@namilux/db";
// DECISION: ../constants is the dependency list entry for MovementReason; AttributeKind and
// CollectionKind come from the same module and are what `queryFacetSources` must carry so that
// facets.ts can build `AttributeFacet` / order the collection facet without a second query.
import type { AttributeKind, CollectionKind, MovementReason } from "../constants";
import type { Actor } from "../types";
import { appError } from "../errors";
import { faNorm } from "../persian";
// The instalment price is derived from the fixed one on every price write; the arithmetic lives in
// pricing/instalments.ts (pure) and only the statement that persists it lives here.
import { deriveInstalmentPrice } from "../pricing/instalments";
import type { InstalmentsRule } from "../pricing/instalments";
import { NEW_DAYS, type BrandRef, type ProductCardSource } from "./cards";
import { type ImageRef, type MediaRowLike, type Renditions, toImageRef } from "./media";
import type { ListPlan, ProductScope, WhereTerm } from "./list";

export type ProductRow = {
  id: number;
  slug: string;
  name: string;
  displayName: string;
  brandId: number | null;
  modelId: number | null;
  sku: string | null;
  modelCode: string | null;
  colorName: string | null;
  colorHex: string | null;
  swatchMediaId: string | null;
  status: "draft" | "active" | "archived";
  visibility: "public" | "hidden" | "link_only";
  price: number;
  compareAtPrice: number | null;
  instalmentPrice: number | null;
  instalmentPriceManual: boolean;
  /** false = not purchasable in instalments (the instalment storefront); card purchase ignores it. */
  instalmentEligible: boolean;
  priceBasis: "manual" | "fx";
  priceUpdatedAt: string | null;
  stockPolicy: "track" | "untracked";
  stockQty: number;
  allowBackorder: boolean;
  lowStockThreshold: number;
  maxPerOrder: number;
  shortHtml: string;
  descriptionHtml: string;
  warrantyMonths: number | null;
  warrantyText: string;
  weightG: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  videoMediaId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  robots: string;
  legacyLastmod: string | null;
  ratingAvg: number;
  ratingCount: number;
  viewCount: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductAdminRow = ProductRow & {
  costPrice: number | null;
  basePrice: number | null;
  baseCurrency: string | null;
};

/** What the two instalment columns look like on any row that carries them. */
export type InstalmentPriceFields = {
  /** null = never derived; on the instalment site that reads as 0 (on request), like price 0. */
  instalmentPrice: number | null;
  /** true = a human pinned the value above and no price write may re-derive it. */
  instalmentPriceManual: boolean;
};

// DECISION (M0 step 3): ProductImageRow / SpecRow / ProductCollectionRef / ProductRelationRow /
// PriceHistoryRow are declared once in ../types (the spec - domain types live in
// @namilux/core/types and repositories map DB rows onto them). Re-exported here so ./index.ts and
// ./products.service.ts keep importing them from this module.
import type {
  ProductImageRow,
  SpecRow,
  ProductCollectionRef,
  ProductRelationRow,
  PriceHistoryRow,
  VariantSwatch,
} from "../types";

export type {
  ProductImageRow,
  SpecRow,
  ProductCollectionRef,
  ProductRelationRow,
  PriceHistoryRow,
};

// DECISION (M1): the module contract gives `SpecRow` and `ProductCollectionRef` RICHER shapes
// than the canonical ../types declarations the M0 de-duplication kept (`SpecRow = {label,value}` is
// the ProductDetail row inside a SpecGroup; `ProductCollectionRef = {slug,name,kind}` is the PDP
// chip). Re-declaring either name here would make `export *` in src/index.ts ambiguous (TS2308),
// so the contract's shapes live on under names that cannot collide, and `ProductFull` uses them - 
// no field of the contract is lost and no ../types consumer is renamed.
//
export type ProductSpecRow = {
  id: number;
  groupName: string | null;
  label: string;
  value: string;
  sort: number;
};

export type ProductCollectionMembership = ProductCollectionRef & { id: number; live: boolean };

export type ProductCategoryRef = {
  id: number;
  name: string;
  path: string;
  isPrimary: boolean;
  status: "active" | "hidden" | "archived";
};

export type ProductAttributeRow = {
  key: string;
  label: string;
  unit: string | null;
  kind: "text" | "number" | "bool" | "color";
  isComparable: boolean;
  isFilterable: boolean;
  valueText: string | null;
  valueNum: number | null;
};

export type ProductFull = {
  row: ProductRow;
  brand: BrandRef | null;
  images: ProductImageRow[];
  specs: ProductSpecRow[];
  categories: ProductCategoryRef[];
  collections: ProductCollectionMembership[];
  attributes: ProductAttributeRow[];
  relations: ProductRelationRow[];
  video: MediaRowLike | null;
  swatch: MediaRowLike | null;
  reservedQty: number;
  siblingIds: number[];
};

/**
 * DECISION: unlike `price`/`compare_at_price`, BOTH instalment columns are written here. The manual
 * flag is a plain form field, and the pinned value that goes with it has no `price_history` to be
 * bypassed - history records the FIXED price, which this path still may not touch. `updatePrice`
 * then re-derives the non-manual case in the same transaction, so the two agree either way.
 */
export type ProductWriteValues = Omit<
  ProductAdminRow,
  | "id"
  | "createdAt"
  | "updatedAt"
  | "ratingAvg"
  | "ratingCount"
  | "viewCount"
  | "stockQty"
  | "price"
  | "compareAtPrice"
  | "priceUpdatedAt"
> & { id?: number };

export type MovementRow = {
  delta: number;
  reason: MovementReason;
  orderId: string | null;
  note: string | null;
  createdAt: string;
};

/** One brand row of the scope facet - facets.ts turns it into a `FacetOption`. */
export type FacetBrandSource = { id: number; slug: string; name: string; count: number };

/** One collection row of the scope facet (`kind` and `sort` drive the facets.ts ordering). */
export type FacetCollectionSource = {
  id: number;
  slug: string;
  name: string;
  kind: CollectionKind;
  sort: number;
  count: number;
};

/**
 * One (attribute, value) pair of the scope facet. `value` is the URL token - the SQL twin of
 * facets.attributeValueKey - and `valueLabel` the raw text a shopper reads. `hex` / `swatch` are
 * filled for the "color" attribute only (facets.ts rules: taken from the first product carrying
 * that value).
 */
export type FacetAttributeSource = {
  key: string;
  label: string;
  unit: string | null;
  kind: AttributeKind;
  sort: number;
  value: string;
  valueLabel: string;
  count: number;
  hex: string | null;
  swatch: ImageRef | null;
};

/** Everything facets.computeFacets needs to assemble `Facets` for one scope, in one call. */
export type FacetSources = {
  total: number;
  price: { min: number; max: number };
  avail: { in: number; sale: number; ready: number };
  brands: FacetBrandSource[];
  collections: FacetCollectionSource[];
  attributes: FacetAttributeSource[];
};

// ── shared SQL fragments ───────────────────────────────────────────────────────────────────────

/**
 * The outer product row, written as a qualified identifier. Drizzle renders a `Column` placed in a
 * `.select({…})` projection WITHOUT its table prefix, which would make `"id"` bind to the inner
 * table of a correlated sub-select (inventory_reservations and product_images both have an `id`).
 * These fragments are reused in projections, WHERE clauses and ORDER BY, so the correlation is
 * spelled out once. `products` is never aliased in this file.
 */
const PRODUCT_ID = sql.raw("products.id");

/**
 * Availability follows persisted holds. An elapsed deadline alone does not free stock while a
 * callback or the expiry worker is deciding the order's outcome.
 */
const reservedQtySql = sql<number>`(
  select coalesce(sum(res.qty), 0)::int
  from inventory_reservations res
  where res.product_id = ${PRODUCT_ID}
    and res.released_at is null
    and res.consumed_at is null
)`;

export const availableSql = sql`(
  ${products.stockPolicy} = 'untracked'
  or ${products.allowBackorder}
  or (${products.stockQty} - ${reservedQtySql}) >= 1
)`;

/** "on sale" is compare_at > price > 0 - never a stored flag. */
const saleSql = sql`(${products.compareAtPrice} > ${products.price} and ${products.price} > 0)`;

/** The listable base (list.ts rules): draft, hidden, link_only and archived rows never list. */
const baseSql = sql`(${products.status} = 'active' and ${products.visibility} = 'public')`;

/** cards.NEW_DAYS as a SQL boundary, so `is_new` in SQL and the «جدید» badge cannot disagree. */
const newSinceSql = sql`(now() - make_interval(days => ${NEW_DAYS}))`;

/** Match the public media mapper: quarantined/missing renditions are not usable photography. */
const hasImageSql = sql`exists (
  select 1 from product_images pim join media pm on pm.id = pim.media_id
  where pim.product_id = ${PRODUCT_ID} and pm.kind = 'image'
    and pm.renditions_json is not null
    and coalesce(pm.normalize_json->>'quarantined', 'false') <> 'true'
)`;

/** Homepage-only merchandising gate; old imports remain searchable in the full catalog. */
const presentationImageSql = sql`exists (
  select 1 from product_images pim join media pm on pm.id = pim.media_id
  where pim.product_id = ${PRODUCT_ID} and pim.role = 'primary' and pm.kind = 'image'
    and pm.source = 'admin' and pm.width >= 800 and pm.renditions_json is not null
    and coalesce(pm.normalize_json->>'quarantined', 'false') <> 'true'
)`;

/** sort.ts `discount_pct`: the sale percentage, rounded and clamped 1..99, 0 for non-sale rows. */
const discountPctSql = sql`(case when ${saleSql}
  then least(99, greatest(1, round(((${products.compareAtPrice} - ${products.price})::numeric / ${products.compareAtPrice}) * 100)))::int
  else 0 end)`;

/** sort.recommendedTier as SQL: 0 buyable · 1 in-stock on-request · 2 on sale but out · 3 out. */
const tierSql = sql`(case
  when ${availableSql} and ${products.price} > 0 then 0
  when ${availableSql} then 1
  when ${saleSql} then 2
  else 3 end)`;

const isNewSql = sql`(${products.publishedAt} is not null and ${products.publishedAt} >= ${newSinceSql})`;

/**
 * The SQL twin of facets.attributeValueKey over the aliases `a` (attributes) and `pav`
 * (product_attribute_values): text/color → nl_fa_norm(value_text) (the IMMUTABLE SQL twin of
 * faNorm, 0000_extensions.sql); number → the plain decimal String(valueNum); bool → "1" / "0".
 */
const attrValueKeySql = sql`(case ${sql.raw("a.kind")}
  when 'number' then coalesce((${sql.raw("pav.value_num")})::float8::text, '')
  when 'bool' then (case
    when ${sql.raw("pav.value_num")} is not null then (case when ${sql.raw("pav.value_num")} <> 0 then '1' else '0' end)
    when nl_fa_norm(coalesce(${sql.raw("pav.value_text")}, '')) in ('1', 'true', 'yes', 'on') then '1'
    else '0' end)
  else nl_fa_norm(coalesce(${sql.raw("pav.value_text")}, '')) end)`;

/**
 * Membership of the collection aliased `c`: manual `collection_products` ∪ `rule_json` evaluation,
 * with exactly the semantics collections.ruleMatches states (every present key must hold; an absent
 * key matches everything; a price bound excludes on-request rows). `tags` is ignored - products
 * have no tags column at P0 and collections.ts rejects a non-empty `tags` at write time.
 */
const collectionMemberSql = sql`(
  exists (select 1 from collection_products cp where cp.collection_id = ${sql.raw("c.id")} and cp.product_id = ${PRODUCT_ID})
  or (
    ${sql.raw("c.rule_json")} is not null
    and (${sql.raw("c.rule_json -> 'brandIds'")} is null or ${products.brandId} in (
      select (el.value)::int from jsonb_array_elements_text(${sql.raw("c.rule_json -> 'brandIds'")}) as el(value)))
    and (${sql.raw("c.rule_json -> 'categoryIds'")} is null or exists (
      select 1 from product_categories pc where pc.product_id = ${PRODUCT_ID} and pc.category_id in (
        select (el.value)::int from jsonb_array_elements_text(${sql.raw("c.rule_json -> 'categoryIds'")}) as el(value))))
    and (${sql.raw("c.rule_json -> 'priceMin'")} is null or (${products.price} > 0 and ${products.price} >= (${sql.raw("c.rule_json ->> 'priceMin'")})::bigint))
    and (${sql.raw("c.rule_json -> 'priceMax'")} is null or (${products.price} > 0 and ${products.price} <= (${sql.raw("c.rule_json ->> 'priceMax'")})::bigint))
    and ((${sql.raw("c.rule_json ->> 'onSale'")})::boolean is not true or ${saleSql})
    and ((${sql.raw("c.rule_json ->> 'inStock'")})::boolean is not true or ${availableSql})
  )
)`;

/** A bound-parameter `IN (…)` list - never string interpolation. */
const idList = (ids: readonly number[]): SQL =>
  sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );

/** A term that can never widen a result set: an unresolved dimension matches nothing (fail closed). */
const NEVER = sql`false`;

const collectionScopeSql = (ids: readonly number[]): SQL =>
  ids.length === 0
    ? NEVER
    : sql`exists (select 1 from collections c where c.id in (${idList(ids)}) and ${collectionMemberSql})`;

const giftScopeSql = sql`exists (
  select 1 from collection_products cpg
  join collections cg on cg.id = cpg.collection_id
  where cpg.product_id = ${PRODUCT_ID} and cg.kind = 'gift' and cg.status = 'active'
)`;

/** The category scope is the category AND all of its descendants (list.ts rules), resolved in SQL. */
const categoryTreeSql = (rootIds: readonly number[]): SQL =>
  rootIds.length === 0
    ? NEVER
    : sql`exists (
  select 1 from product_categories pct
  where pct.product_id = ${PRODUCT_ID}
    and pct.category_id in (
      with recursive tree(id) as (
        select cat.id from categories cat where cat.id in (${idList(rootIds)})
        union all
        select child.id from categories child join tree on child.parent_id = tree.id
      )
      select tree.id from tree
    )
)`;

// ── row mapping (the DB → domain boundary, the spec) ──────────────────────────────────────────────

/**
 * DECISION: an unrepresentable date degrades to null rather than throwing. Product 54256 carries
 * `published_at = 1404-08-04 10:22:00+03:25:44` - a Jalali year with an LMT offset - which the
 * driver hands back as an Invalid Date; `toISOString()` then throws a RangeError and takes the whole
 * query down. `seo/sitemaps.ts` made the same call for the same row. A missing date costs a sort
 * key; a throw costs the page.
 */
const iso = (value: Date | null): string | null => {
  if (value === null || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
};

const num = (value: string | number | null): number | null => {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

type ProductRowRaw = {
  id: number;
  slug: string;
  name: string;
  displayName: string;
  brandId: number | null;
  modelId: number | null;
  sku: string | null;
  modelCode: string | null;
  colorName: string | null;
  colorHex: string | null;
  swatchMediaId: string | null;
  status: ProductRow["status"];
  visibility: ProductRow["visibility"];
  price: number;
  compareAtPrice: number | null;
  instalmentPrice: number | null;
  instalmentPriceManual: boolean;
  instalmentEligible: boolean;
  priceBasis: ProductRow["priceBasis"];
  priceUpdatedAt: Date | null;
  stockPolicy: ProductRow["stockPolicy"];
  stockQty: number;
  allowBackorder: boolean;
  lowStockThreshold: number;
  maxPerOrder: number;
  shortHtml: string | null;
  descriptionHtml: string | null;
  warrantyMonths: number | null;
  warrantyText: string | null;
  weightG: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  videoMediaId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  robots: string;
  legacyLastmod: Date | null;
  ratingAvg: string;
  ratingCount: number;
  viewCount: number;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** The explicit column list of every WEB query - cost_price/base_price/base_currency are ABSENT. */
const productRowColumns = {
  id: products.id,
  slug: products.slug,
  name: products.name,
  displayName: products.displayName,
  brandId: products.brandId,
  modelId: products.modelId,
  sku: products.sku,
  modelCode: products.modelCode,
  colorName: products.colorName,
  colorHex: products.colorHex,
  swatchMediaId: products.swatchMediaId,
  status: products.status,
  visibility: products.visibility,
  price: products.price,
  compareAtPrice: products.compareAtPrice,
  instalmentPrice: products.instalmentPrice,
  instalmentPriceManual: products.instalmentPriceManual,
  instalmentEligible: products.instalmentEligible,
  priceBasis: products.priceBasis,
  priceUpdatedAt: products.priceUpdatedAt,
  stockPolicy: products.stockPolicy,
  stockQty: products.stockQty,
  allowBackorder: products.allowBackorder,
  lowStockThreshold: products.lowStockThreshold,
  maxPerOrder: products.maxPerOrder,
  shortHtml: products.shortHtml,
  descriptionHtml: products.descriptionHtml,
  warrantyMonths: products.warrantyMonths,
  warrantyText: products.warrantyText,
  weightG: products.weightG,
  lengthMm: products.lengthMm,
  widthMm: products.widthMm,
  heightMm: products.heightMm,
  videoMediaId: products.videoMediaId,
  seoTitle: products.seoTitle,
  seoDescription: products.seoDescription,
  robots: products.robots,
  legacyLastmod: products.legacyLastmod,
  ratingAvg: products.ratingAvg,
  ratingCount: products.ratingCount,
  viewCount: products.viewCount,
  publishedAt: products.publishedAt,
  createdAt: products.createdAt,
  updatedAt: products.updatedAt,
} as const;

/** findAdminRow ONLY (rules): the three admin columns on top of the web set. */
const productAdminColumns = {
  ...productRowColumns,
  costPrice: products.costPrice,
  basePrice: products.basePrice,
  baseCurrency: products.baseCurrency,
} as const;

function toProductRow(r: ProductRowRaw): ProductRow {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    displayName: r.displayName,
    brandId: r.brandId,
    modelId: r.modelId,
    sku: r.sku,
    modelCode: r.modelCode,
    colorName: r.colorName,
    colorHex: r.colorHex,
    swatchMediaId: r.swatchMediaId,
    status: r.status,
    visibility: r.visibility,
    price: r.price,
    compareAtPrice: r.compareAtPrice,
    instalmentPrice: r.instalmentPrice,
    instalmentPriceManual: r.instalmentPriceManual,
    instalmentEligible: r.instalmentEligible,
    priceBasis: r.priceBasis,
    priceUpdatedAt: iso(r.priceUpdatedAt),
    stockPolicy: r.stockPolicy,
    stockQty: r.stockQty,
    allowBackorder: r.allowBackorder,
    lowStockThreshold: r.lowStockThreshold,
    maxPerOrder: r.maxPerOrder,
    // Nullable in the spec but typed `string` by the contract: an absent body is the empty string.
    shortHtml: r.shortHtml ?? "",
    descriptionHtml: r.descriptionHtml ?? "",
    warrantyMonths: r.warrantyMonths,
    warrantyText: r.warrantyText ?? "",
    weightG: r.weightG,
    lengthMm: r.lengthMm,
    widthMm: r.widthMm,
    heightMm: r.heightMm,
    videoMediaId: r.videoMediaId,
    seoTitle: r.seoTitle,
    seoDescription: r.seoDescription,
    robots: r.robots,
    legacyLastmod: iso(r.legacyLastmod),
    ratingAvg: num(r.ratingAvg) ?? 0,
    ratingCount: r.ratingCount,
    viewCount: r.viewCount,
    publishedAt: iso(r.publishedAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

type MediaRowRaw = {
  id: string;
  kind: "image" | "video" | "file";
  storageKey: string;
  mime: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  alt: string;
  lqip: string | null;
  renditionsJson: unknown;
  normalizeJson: unknown;
};

const mediaColumns = {
  id: media.id,
  kind: media.kind,
  storageKey: media.storageKey,
  mime: media.mime,
  width: media.width,
  height: media.height,
  durationMs: media.durationMs,
  alt: media.alt,
  lqip: media.lqip,
  renditionsJson: media.renditionsJson,
  normalizeJson: media.normalizeJson,
} as const;

/**
 * jsonb is `unknown` at this boundary: the DB-side `MediaRenditions` / `MediaNormalizeInfo` shapes
 * are looser than media.ts's (`master` optional there, `reason: string | null` here) and
 * `toImageRef` re-validates every field at runtime anyway.
 */
function toMediaRowLike(r: MediaRowRaw, alt?: string): MediaRowLike {
  return {
    id: r.id,
    kind: r.kind,
    storageKey: r.storageKey,
    mime: r.mime,
    width: r.width,
    height: r.height,
    durationMs: r.durationMs,
    // DECISION: `product_images.alt` is the product-specific caption and wins over `media.alt`;
    // media.toImageRef then falls back to the display name so a card alt is never empty.
    alt: alt !== undefined && alt.trim() !== "" ? alt : r.alt,
    lqip: r.lqip,
    renditionsJson: (r.renditionsJson ?? null) as Renditions | null,
    normalizeJson: r.normalizeJson ?? null,
  };
}

// ── satellite loaders (one round trip each - never N+1) ────────────────────────────────────────

type ImageRowRaw = {
  id: number;
  productId: number;
  role: "primary" | "gallery" | "editorial";
  sort: number;
  alt: string;
  media: MediaRowRaw;
};

const ROLE_RANK: Readonly<Record<ImageRowRaw["role"], number>> = {
  primary: 0,
  gallery: 1,
  editorial: 2,
};

/**
 * EDGE CASE: "a product with two `primary` images → lowest sort wins, the other treated as gallery".
 * The partial unique index makes that impossible going forward; the legacy import is not so tidy,
 * so the ordering is decided here rather than trusted from the table.
 */
function orderImages(rows: readonly ImageRowRaw[]): ImageRowRaw[] {
  const bySort = [...rows].sort((a, b) => a.sort - b.sort || a.id - b.id);
  const winner = bySort.find((r) => r.role === "primary");
  const rank = (row: ImageRowRaw): number => ROLE_RANK[row.role === "primary" ? "gallery" : row.role];
  const rest = bySort
    .filter((r) => r !== winner)
    .sort((a, b) => rank(a) - rank(b) || a.sort - b.sort || a.id - b.id);
  return winner === undefined ? rest : [winner, ...rest];
}

async function loadImages(db: Db, ids: readonly number[]): Promise<Map<number, ImageRowRaw[]>> {
  const out = new Map<number, ImageRowRaw[]>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      id: productImages.id,
      productId: productImages.productId,
      role: productImages.role,
      sort: productImages.sort,
      alt: productImages.alt,
      media: mediaColumns,
    })
    .from(productImages)
    .innerJoin(media, eq(media.id, productImages.mediaId))
    .where(inArray(productImages.productId, [...ids]));

  for (const row of rows) {
    const bucket = out.get(row.productId);
    if (bucket === undefined) out.set(row.productId, [row]);
    else bucket.push(row);
  }
  for (const [productId, bucket] of out) out.set(productId, orderImages(bucket));
  return out;
}

async function loadMediaByIds(db: Db, ids: readonly string[]): Promise<Map<string, MediaRowRaw>> {
  const out = new Map<string, MediaRowRaw>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const rows = await db.select(mediaColumns).from(media).where(inArray(media.id, unique));
  for (const row of rows) out.set(row.id, row);
  return out;
}

async function loadReserved(db: Db, ids: readonly number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      productId: inventoryReservations.productId,
      qty: sql<number>`coalesce(sum(${inventoryReservations.qty}), 0)::int`,
    })
    .from(inventoryReservations)
    .where(
      and(
        inArray(inventoryReservations.productId, [...ids]),
        sql`${inventoryReservations.releasedAt} is null`,
        sql`${inventoryReservations.consumedAt} is null`,
      ),
    )
    .groupBy(inventoryReservations.productId);
  for (const row of rows) out.set(row.productId, Number(row.qty));
  return out;
}

// ── reads ──────────────────────────────────────────────────────────────────────────────────────

export async function findBySlug(
  db: Db,
  slug: string,
  opts?: { includeArchived?: boolean },
): Promise<ProductFull | null> {
  const where =
    opts?.includeArchived === true
      ? eq(products.slug, slug)
      : and(eq(products.slug, slug), ne(products.status, "archived"));

  const [raw] = await db
    .select({
      ...productRowColumns,
      brandSlug: brands.slug,
      brandNameFa: brands.nameFa,
      brandNameEn: brands.nameEn,
    })
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(where)
    .limit(1);
  if (raw === undefined) return null;

  const row = toProductRow(raw);
  const mediaIds = [row.videoMediaId, row.swatchMediaId].filter((id): id is string => id !== null);

  const [
    images,
    specRows,
    categoryRows,
    collectionRows,
    attributeRows,
    relationRows,
    mediaRows,
    reserved,
    siblingIds,
  ] = await Promise.all([
    loadImages(db, [row.id]),
    db
      .select({
        id: productSpecs.id,
        groupName: productSpecs.groupName,
        label: productSpecs.label,
        value: productSpecs.value,
        sort: productSpecs.sort,
      })
      .from(productSpecs)
      .where(eq(productSpecs.productId, row.id))
      .orderBy(asc(productSpecs.sort), asc(productSpecs.id)),
    db
      .select({
        id: categoriesTable.id,
        name: categoriesTable.name,
        path: categoriesTable.path,
        isPrimary: productCategories.isPrimary,
        status: categoriesTable.status,
      })
      .from(productCategories)
      .innerJoin(categoriesTable, eq(categoriesTable.id, productCategories.categoryId))
      .where(eq(productCategories.productId, row.id))
      .orderBy(desc(productCategories.isPrimary), asc(categoriesTable.sort), asc(categoriesTable.id)),
    db
      .select({
        id: collections.id,
        slug: collections.slug,
        name: collections.name,
        kind: collections.kind,
        live: sql<boolean>`(${collections.status} = 'active'
          and (${collections.startsAt} is null or ${collections.startsAt} <= now())
          and (${collections.endsAt} is null or ${collections.endsAt} > now()))`,
      })
      .from(collectionProducts)
      .innerJoin(collections, eq(collections.id, collectionProducts.collectionId))
      .where(eq(collectionProducts.productId, row.id))
      .orderBy(asc(collections.sort), asc(collections.id)),
    db
      .select({
        key: attributes.key,
        label: attributes.label,
        unit: attributes.unit,
        kind: attributes.kind,
        isComparable: attributes.isComparable,
        isFilterable: attributes.isFilterable,
        valueText: productAttributeValues.valueText,
        valueNum: productAttributeValues.valueNum,
      })
      .from(productAttributeValues)
      .innerJoin(attributes, eq(attributes.id, productAttributeValues.attributeId))
      .where(eq(productAttributeValues.productId, row.id))
      .orderBy(asc(attributes.sort), asc(attributes.key)),
    db
      .select({
        kind: productRelations.kind,
        relatedId: productRelations.relatedId,
        sort: productRelations.sort,
      })
      .from(productRelations)
      .where(eq(productRelations.productId, row.id))
      .orderBy(asc(productRelations.kind), asc(productRelations.sort), asc(productRelations.relatedId)),
    loadMediaByIds(db, mediaIds),
    loadReserved(db, [row.id]),
    row.modelId === null ? Promise.resolve<number[]>([]) : findSiblingIds(db, row.modelId, row.id),
  ]);

  const brand: BrandRef | null =
    raw.brandSlug === null || raw.brandNameFa === null || raw.brandNameEn === null
      ? null
      : { slug: raw.brandSlug, name: raw.brandNameFa, nameEn: raw.brandNameEn };

  const videoRow = row.videoMediaId === null ? undefined : mediaRows.get(row.videoMediaId);
  const swatchRow = row.swatchMediaId === null ? undefined : mediaRows.get(row.swatchMediaId);

  return {
    row,
    brand,
    // A quarantined / rendition-less media row maps to null and is dropped: the gallery must never
    // render a broken source (media.ts rules).
    images: (images.get(row.id) ?? []).flatMap((image): ProductImageRow[] => {
      const ref = toImageRef(toMediaRowLike(image.media, image.alt), { altFallback: row.displayName });
      return ref === null ? [] : [{ id: image.id, media: ref, role: image.role, sort: image.sort, alt: ref.alt }];
    }),
    specs: specRows,
    categories: categoryRows,
    collections: collectionRows,
    attributes: attributeRows.map((a) => ({ ...a, valueNum: num(a.valueNum) })),
    relations: relationRows,
    video: videoRow === undefined ? null : toMediaRowLike(videoRow),
    swatch: swatchRow === undefined ? null : toMediaRowLike(swatchRow),
    reservedQty: reserved.get(row.id) ?? 0,
    siblingIds,
  };
}

type CardRowRaw = ProductRowRaw & {
  brandSlug: string | null;
  brandNameFa: string | null;
  brandNameEn: string | null;
};

const cardColumns = {
  ...productRowColumns,
  brandSlug: brands.slug,
  brandNameFa: brands.nameFa,
  brandNameEn: brands.nameEn,
} as const;

function brandOf(r: CardRowRaw): BrandRef | null {
  if (r.brandSlug === null || r.brandNameFa === null || r.brandNameEn === null) return null;
  return { slug: r.brandSlug, name: r.brandNameFa, nameEn: r.brandNameEn };
}

export async function findCardSources(db: Db, ids: readonly number[]): Promise<ProductCardSource[]> {
  if (ids.length === 0) return [];
  const wanted = [...new Set(ids)];

  // rules: archived rows are excluded from every read but findBySlug({includeArchived}) / findAdminRow.
  const rows: CardRowRaw[] = await db
    .select(cardColumns)
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(and(inArray(products.id, wanted), ne(products.status, "archived")));

  const modelIds = [...new Set(rows.map((r) => r.modelId).filter((m): m is number => m !== null))];
  const siblingRows: CardRowRaw[] =
    modelIds.length === 0
      ? []
      : await db
          .select(cardColumns)
          .from(products)
          .leftJoin(brands, eq(brands.id, products.brandId))
          .where(
            and(
              inArray(products.modelId, modelIds),
              // DECISION: a variant swatch links to another PLP-listable product, so the sibling
              // set uses the same base predicate the grid uses - a hidden or draft colour never
              // leaks onto a card.
              baseSql,
            ),
          );

  const universe = [...new Map([...rows, ...siblingRows].map((r) => [r.id, r])).values()];
  const universeIds = universe.map((r) => r.id);
  const swatchIds = universe.map((r) => r.swatchMediaId).filter((id): id is string => id !== null);

  const [images, swatches, reserved] = await Promise.all([
    loadImages(db, universeIds),
    loadMediaByIds(db, swatchIds),
    loadReserved(db, universeIds),
  ]);

  const imageRefs = (r: CardRowRaw): ImageRef[] =>
    (images.get(r.id) ?? []).flatMap((image) => {
      const ref = toImageRef(toMediaRowLike(image.media, image.alt), { altFallback: r.displayName });
      return ref === null ? [] : [ref];
    });

  const swatchRef = (r: CardRowRaw): ImageRef | null => {
    if (r.swatchMediaId === null) return null;
    const found = swatches.get(r.swatchMediaId);
    return found === undefined ? null : toImageRef(toMediaRowLike(found), { altFallback: r.displayName });
  };

  const isAvailableRow = (r: CardRowRaw): boolean =>
    r.stockPolicy === "untracked" || r.allowBackorder || r.stockQty - (reserved.get(r.id) ?? 0) >= 1;

  const siblingsByModel = new Map<number, VariantSwatch[]>();
  for (const s of siblingRows) {
    if (s.modelId === null) continue;
    const swatch: VariantSwatch = {
      productId: s.id,
      slug: s.slug,
      colorName: s.colorName ?? "",
      colorHex: s.colorHex,
      swatch: swatchRef(s),
      image: imageRefs(s)[0] ?? null,
      available: isAvailableRow(s),
      onRequest: s.price === 0,
    };
    const bucket = siblingsByModel.get(s.modelId);
    if (bucket === undefined) siblingsByModel.set(s.modelId, [swatch]);
    else bucket.push(swatch);
  }

  const byId = new Map<number, ProductCardSource>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      slug: r.slug,
      name: r.name,
      displayName: r.displayName,
      brand: brandOf(r),
      modelCode: r.modelCode,
      colorName: r.colorName,
      colorHex: r.colorHex,
      status: r.status,
      visibility: r.visibility,
      price: r.price,
      compareAtPrice: r.compareAtPrice,
      publishedAt: iso(r.publishedAt),
      ratingAvg: num(r.ratingAvg) ?? 0,
      ratingCount: r.ratingCount,
      images: imageRefs(r),
      swatch: swatchRef(r),
      modelId: r.modelId,
      // Exclude only this card, not the rest of its batch: siblings may share a listing page.
      siblings:
        r.modelId === null ? [] : (siblingsByModel.get(r.modelId) ?? []).filter((s) => s.productId !== r.id),
      stockPolicy: r.stockPolicy,
      stockQty: r.stockQty,
      reservedQty: reserved.get(r.id) ?? 0,
      allowBackorder: r.allowBackorder,
      lowStockThreshold: r.lowStockThreshold,
      maxPerOrder: r.maxPerOrder,
    });
  }

  // EDGE CASE: "findCardSources([3,1,2]) → order [3,1,2]; with an unknown id → skipped, no throw".
  const out: ProductCardSource[] = [];
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const source = byId.get(id);
    if (source !== undefined) out.push(source);
  }
  return out;
}

// ── list plan execution ────────────────────────────────────────────────────────────────────────

function attributeTermSql(key: string, values: readonly string[]): SQL {
  if (values.length === 0) return NEVER;
  const tokens = sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
  return sql`exists (
    select 1 from product_attribute_values pav
    join attributes a on a.id = pav.attribute_id
    where pav.product_id = ${PRODUCT_ID} and a.key = ${key} and ${attrValueKeySql} in (${tokens})
  )`;
}

function whereTermSql(term: WhereTerm): SQL {
  switch (term.kind) {
    case "base":
      return baseSql;
    case "category_in":
      return categoryTreeSql(term.ids);
    case "brand_in":
      return term.ids.length === 0 ? NEVER : sql`${products.brandId} in (${idList(term.ids)})`;
    case "collection_in":
      return collectionScopeSql(term.ids);
    case "sale":
      return saleSql;
    case "new": {
      const since = new Date(term.sinceIso);
      // A malformed boundary must never silently widen `/new/` to the whole catalogue.
      if (Number.isNaN(since.getTime())) return NEVER;
      // DECISION: bind the ISO string, not the Date. postgres.js serialises a bound parameter
      // itself and rejects a Date here ("The \"string\" argument must be … Received an instance of
      // Date"), which made `/new/` a hard 500 - every other scope binds primitives, so this was the
      // only one that failed.
      return sql`(${products.publishedAt} is not null and ${products.publishedAt} >= ${since.toISOString()})`;
    }
    case "gift_collections":
      return giftScopeSql;
    case "ids":
      return term.ids.length === 0 ? NEVER : sql`${products.id} in (${idList(term.ids)})`;
    case "price_between": {
      const bounds: SQL[] = [sql`${products.price} > 0`];
      if (term.min !== null) bounds.push(sql`${products.price} >= ${term.min}`);
      if (term.max !== null) bounds.push(sql`${products.price} <= ${term.max}`);
      return sql`(${sql.join(bounds, sql` and `)})`;
    }
    case "avail": {
      const parts = term.keys.map((key) => {
        switch (key) {
          case "in":
            return availableSql;
          case "sale":
            return saleSql;
          case "ready":
            return sql`(${availableSql} and ${products.price} > 0)`;
        }
      });
      // list.ts drops an empty `avail` group; a defensive empty term must not narrow the scope.
      return parts.length === 0 ? sql`true` : sql`(${sql.join(parts, sql` or `)})`;
    }
    case "color_in":
      return attributeTermSql("color", term.values);
    case "attr":
      return attributeTermSql(term.key, term.values);
  }
}

/** metrics_daily rolled up per product over the trailing 90 days - joined ONLY for `bestselling`. */
function sold90dSubquery(db: Db) {
  return db
    .select({
      productId: sql<number>`(split_part(${metricsDaily.dim}, ':', 2))::int`.as("product_id"),
      sold: sql<number>`sum(${metricsDaily.value})`.as("sold"),
    })
    .from(metricsDaily)
    .where(
      and(
        eq(metricsDaily.metric, "product.sold_qty"),
        sql`${metricsDaily.dim} ~ '^product:[0-9]+$'`,
        sql`${metricsDaily.day} >= (current_date - 90)`,
      ),
    )
    .groupBy(sql`1`)
    .as("sold90");
}

export async function queryCards(db: Db, plan: ListPlan): Promise<{ ids: number[]; total: number }> {
  const sold90 = sold90dSubquery(db);
  const terms = plan.where.map(whereTermSql);
  const where = terms.length === 0 ? baseSql : sql`(${sql.join(terms, sql` and `)})`;

  const orderColumn = (column: (typeof plan.orderBy)[number]["column"]): SQL => {
    switch (column) {
      case "tier":
        return tierSql;
      case "is_new":
        return isNewSql;
      case "price_is_zero":
        return sql`(${products.price} = 0)`;
      case "price":
        return sql`${products.price}`;
      case "discount_pct":
        return discountPctSql;
      case "sold_90d":
        // Defensive: a plan asking for sold_90d without needsSold90d gets a constant, never a join.
        return plan.needsSold90d ? sql`${sold90.sold}` : sql`0`;
      case "published_at":
        return sql`${products.publishedAt}`;
      case "id":
        return sql`${products.id}`;
    }
  };

  const orderBy = plan.orderBy.map(
    (term) =>
      sql`${orderColumn(term.column)}${term.dir === "asc" ? sql` asc` : sql` desc`}${
        term.nulls === "last" ? sql` nulls last` : sql.empty()
      }`,
  );

  let query = db
    .select({ id: products.id, total: sql<number>`cast(count(*) over () as int)` })
    .from(products)
    .$dynamic();
  // EDGE CASE: "queryCards with plan.needsSold90d → LEFT JOIN metrics aggregate; without → no join".
  if (plan.needsSold90d) query = query.leftJoin(sold90, eq(sold90.productId, products.id));

  // DECISION: the plan's ORDER BY is executed verbatim. The `ids` WhereTerm documents "order
  // preserved by the caller" - list.ts hands queryCards' ids to findCardSources, which is where the
  // caller's order survives; the repository never re-sorts a plan.
  const rows = await query
    .where(where)
    .orderBy(...orderBy)
    .limit(plan.limit)
    .offset(plan.offset);

  if (rows.length > 0) return { ids: rows.map((r) => r.id), total: Number(rows[0]?.total ?? 0) };

  // A window function reports nothing when the window is empty, so an OFFSET past the last page
  // came back as `total: 0` - indistinguishable from "this scope has no products", which made a
  // deep `?page=N` render as an empty catalogue rather than a 404. Only that one case pays for a
  // second statement; page 1 of an empty scope is still a single query.
  if (plan.offset === 0) return { ids: [], total: 0 };
  let countQuery = db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(products)
    .$dynamic();
  if (plan.needsSold90d) countQuery = countQuery.leftJoin(sold90, eq(sold90.productId, products.id));
  const counted = await countQuery.where(where);
  return { ids: [], total: Number(counted[0]?.total ?? 0) };
}

export async function listPublicIds(db: Db): Promise<number[]> {
  const rows = await db.select({ id: products.id }).from(products).where(baseSql).orderBy(asc(products.id));
  return rows.map((r) => r.id);
}

/** Published, priced products with usable photography for SnappPay discovery. */
export async function listSnapppayFeedProducts(db: Db, input: { page: number; size: number; id?: number; slug?: string }): Promise<{ slugs: string[]; total: number }> {
  const where = and(baseSql, hasImageSql, eq(products.instalmentEligible, true), sql`${products.price} > 0`,
    input.id === undefined ? undefined : eq(products.id, input.id),
    input.slug === undefined ? undefined : eq(products.slug, input.slug));
  const rows = await db.select({ slug: products.slug, total: sql<number>`count(*) over()::int` }).from(products)
    .where(where).orderBy(asc(products.id)).limit(input.size).offset((input.page - 1) * input.size);
  if (rows.length > 0) return { slugs: rows.map((r) => r.slug), total: Number(rows[0]?.total ?? 0) };
  const counts = await db.select({ total: sql<number>`count(*)::int` }).from(products).where(where);
  return { slugs: [], total: Number(counts[0]?.total ?? 0) };
}

/** Same rows as listPublicIds, as slugs - the build's generateStaticParams for /product/[slug] (4 Sep 2026). */
export async function listPublicSlugs(db: Db): Promise<string[]> {
  const rows = await db.select({ slug: products.slug }).from(products).where(baseSql).orderBy(asc(products.id));
  return rows.map((r) => r.slug);
}

export async function listReadyIds(db: Db, limit: number, opts?: { presentation?: boolean }): Promise<number[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(sql`(${baseSql} and ${availableSql} and ${products.price} > 0 and ${opts?.presentation ? presentationImageSql : sql`true`})`)
    // "imaged first, recommended order" - every row here is tier 0, so `tier` is constant.
    .orderBy(sql`${hasImageSql} desc`, sql`${isNewSql} desc`, desc(products.id))
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function listSaleIds(db: Db, limit: number, opts?: { presentation?: boolean }): Promise<number[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(sql`(${baseSql} and ${saleSql} and ${opts?.presentation ? presentationImageSql : sql`true`})`)
    .orderBy(sql`${availableSql} desc`, sql`${discountPctSql} desc`, desc(products.id))
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function findRelatedIds(db: Db, productId: number, n: number): Promise<number[]> {
  if (n <= 0) return [];

  // 1. the curated rows first, in their editorial order.
  const explicit = await db
    .select({ id: productRelations.relatedId })
    .from(productRelations)
    .innerJoin(products, eq(products.id, productRelations.relatedId))
    .where(and(eq(productRelations.productId, productId), eq(productRelations.kind, "related"), baseSql))
    .orderBy(asc(productRelations.sort), asc(productRelations.relatedId))
    .limit(n);

  const picked: number[] = [];
  for (const row of explicit) if (!picked.includes(row.id)) picked.push(row.id);
  if (picked.length >= n) return picked.slice(0, n);

  const [self] = await db
    .select({ brandId: products.brandId, modelId: products.modelId })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  if (self === undefined) return picked;

  const memberships = await db
    .select({ collectionId: collectionProducts.collectionId, kind: collections.kind })
    .from(collectionProducts)
    .innerJoin(collections, eq(collections.id, collectionProducts.collectionId))
    .where(eq(collectionProducts.productId, productId));

  const subIds = memberships.filter((m) => m.kind === "sub").map((m) => m.collectionId);
  const groupIds = memberships.filter((m) => m.kind === "group").map((m) => m.collectionId);

  const shares = (ids: readonly number[]): SQL =>
    ids.length === 0
      ? NEVER
      : sql`exists (select 1 from collection_products cpr where cpr.product_id = ${PRODUCT_ID} and cpr.collection_id in (${idList(ids)}))`;

  // LIFT (_legacy/.../catalog.ts related()): sub 4 + group 2 + brand 1 + image 0.5 + available 0.25.
  const affinity = sql`((case when ${shares(subIds)} then 4 else 0 end)
    + (case when ${shares(groupIds)} then 2 else 0 end)
    + (case when ${self.brandId === null ? NEVER : sql`${products.brandId} = ${self.brandId}`} then 1 else 0 end))`;
  const score = sql`(${affinity}
    + (case when ${hasImageSql} then 0.5 else 0 end)
    + (case when ${availableSql} then 0.25 else 0 end))`;

  const exclusions: SQL[] = [baseSql, sql`${products.id} <> ${productId}`];
  // "exclude … same_model siblings": a variant of the same model is shown by the swatch row, never
  // as a related product.
  if (self.modelId !== null) {
    exclusions.push(sql`(${products.modelId} is null or ${products.modelId} <> ${self.modelId})`);
  }
  if (picked.length > 0) exclusions.push(sql`${products.id} not in (${idList(picked)})`);

  // DECISION: the +0.5 image and +0.25 availability terms are TIE-BREAKERS, not qualifiers. The
  // legacy `score > 0` filter would relate every imaged product to an isolated one, and this
  // header's EDGE CASE demands [] for "no brand, no collections", so a candidate must share a
  // sub-collection, a group collection or the brand.
  const candidates = (await db.execute(sql`
    select cand.id as "id" from (
      select ${products.id} as id, ${affinity} as affinity, ${score} as score
      from ${products}
      where ${sql.join(exclusions, sql` and `)}
    ) cand
    where cand.affinity > 0
    order by cand.score desc, cand.id desc
    limit ${n - picked.length}
  `)) as unknown as { id: number }[];

  for (const row of candidates) if (!picked.includes(Number(row.id))) picked.push(Number(row.id));
  return picked.slice(0, n);
}

export async function findAccessoryIds(db: Db, productId: number): Promise<number[]> {
  const rows = await db
    .select({ id: productRelations.relatedId })
    .from(productRelations)
    .innerJoin(products, eq(products.id, productRelations.relatedId))
    .where(and(eq(productRelations.productId, productId), eq(productRelations.kind, "accessory"), baseSql))
    .orderBy(asc(productRelations.sort), asc(productRelations.relatedId));
  return rows.map((r) => r.id);
}

export async function findSiblingIds(db: Db, modelId: number, excludeId: number): Promise<number[]> {
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.modelId, modelId), ne(products.id, excludeId), baseSql))
    .orderBy(asc(products.id));
  return rows.map((r) => r.id);
}

export async function findAdminRow(db: Db, id: number): Promise<ProductAdminRow | null> {
  const [raw] = await db.select(productAdminColumns).from(products).where(eq(products.id, id)).limit(1);
  if (raw === undefined) return null;
  return {
    ...toProductRow(raw),
    costPrice: raw.costPrice,
    basePrice: num(raw.basePrice),
    baseCurrency: raw.baseCurrency,
  };
}

// ── writes (admin) ─────────────────────────────────────────────────────────────────────────────

/** rules: price, compare_at_price, price_updated_at and stock_qty are NEVER written here. */
function writeValuesOf(v: ProductWriteValues) {
  return {
    slug: v.slug,
    name: v.name,
    displayName: v.displayName,
    brandId: v.brandId,
    modelId: v.modelId,
    sku: v.sku,
    modelCode: v.modelCode,
    colorName: v.colorName,
    colorHex: v.colorHex,
    swatchMediaId: v.swatchMediaId,
    status: v.status,
    visibility: v.visibility,
    costPrice: v.costPrice,
    instalmentPrice: v.instalmentPrice,
    instalmentPriceManual: v.instalmentPriceManual,
    instalmentEligible: v.instalmentEligible,
    priceBasis: v.priceBasis,
    basePrice: v.basePrice === null ? null : String(v.basePrice),
    baseCurrency: v.baseCurrency,
    stockPolicy: v.stockPolicy,
    allowBackorder: v.allowBackorder,
    lowStockThreshold: v.lowStockThreshold,
    maxPerOrder: v.maxPerOrder,
    shortHtml: v.shortHtml,
    descriptionHtml: v.descriptionHtml,
    warrantyMonths: v.warrantyMonths,
    warrantyText: v.warrantyText,
    weightG: v.weightG,
    lengthMm: v.lengthMm,
    widthMm: v.widthMm,
    heightMm: v.heightMm,
    videoMediaId: v.videoMediaId,
    seoTitle: v.seoTitle,
    seoDescription: v.seoDescription,
    robots: v.robots,
    legacyLastmod: v.legacyLastmod === null ? null : new Date(v.legacyLastmod),
    publishedAt: v.publishedAt === null ? null : new Date(v.publishedAt),
  };
}

export async function upsertRow(
  db: Db,
  values: ProductWriteValues,
): Promise<{ id: number; before: ProductAdminRow | null }> {
  const before = values.id === undefined ? null : await findAdminRow(db, values.id);
  const set = writeValuesOf(values);

  let returned: { id: number }[];
  try {
    returned =
      values.id === undefined
        ? await db.insert(products).values(set).returning({ id: products.id })
        : await db
            .insert(products)
            .values({ ...set, id: values.id })
            .onConflictDoUpdate({ target: products.id, set })
            .returning({ id: products.id });
  } catch (err: unknown) {
    // A slug another product already has used to surface as a bare INTERNAL (3 Oct 2026: the admin
    // retried «نینجا» 18 times). drizzle wraps the driver error; look at the Postgres error itself.
    const pg = (err instanceof Error && err.cause instanceof Error ? err.cause : err) as { code?: string; constraint_name?: string; message?: string };
    if (pg.code === "23505" && (pg.constraint_name === "products_slug_uq" || /products_slug_uq/.test(pg.message ?? ""))) {
      throw appError("CONFLICT", { details: { field: "slug", reason: "slug_taken", slug: set.slug } });
    }
    throw err;
  }

  const id = returned[0]?.id;
  if (id === undefined) throw appError("INTERNAL", { details: { op: "upsertRow" } });
  return { id, before };
}

export async function replaceCategories(
  db: Db,
  productId: number,
  rows: { categoryId: number; isPrimary: boolean }[],
): Promise<void> {
  await db.delete(productCategories).where(eq(productCategories.productId, productId));
  // DECISION: deduped by categoryId and at most one `is_primary` survives - the composite PK and
  // the partial unique index of the spec would otherwise abort the whole save with a driver error.
  const seen = new Set<number>();
  let primaryTaken = false;
  const values: { productId: number; categoryId: number; isPrimary: boolean }[] = [];
  for (const row of rows) {
    if (seen.has(row.categoryId)) continue;
    seen.add(row.categoryId);
    const isPrimary = row.isPrimary && !primaryTaken;
    if (isPrimary) primaryTaken = true;
    values.push({ productId, categoryId: row.categoryId, isPrimary });
  }
  if (values.length > 0) await db.insert(productCategories).values(values);
}

export async function replaceImages(
  db: Db,
  productId: number,
  rows: { mediaId: string; role: "primary" | "gallery" | "editorial"; sort: number; alt: string }[],
): Promise<void> {
  await db.delete(productImages).where(eq(productImages.productId, productId));
  // DECISION: only the first `primary` stays primary; a second one is stored as a gallery row
  // (partial unique index `product_images_primary_uq`), mirroring the read-side EDGE CASE.
  let primaryTaken = false;
  const values = rows.map((row) => {
    const keepPrimary = row.role === "primary" && !primaryTaken;
    if (keepPrimary) primaryTaken = true;
    return {
      productId,
      mediaId: row.mediaId,
      role: row.role === "primary" && !keepPrimary ? ("gallery" as const) : row.role,
      sort: row.sort,
      alt: row.alt,
    };
  });
  if (values.length > 0) await db.insert(productImages).values(values);
}

export async function replaceSpecs(
  db: Db,
  productId: number,
  rows: { groupName: string | null; label: string; value: string; sort: number }[],
): Promise<void> {
  await db.delete(productSpecs).where(eq(productSpecs.productId, productId));
  if (rows.length === 0) return;
  await db.insert(productSpecs).values(rows.map((row) => ({ productId, ...row })));
}

export async function replaceAttributeValues(
  db: Db,
  productId: number,
  rows: { attributeId: number; valueText: string | null; valueNum: number | null }[],
): Promise<void> {
  await db.delete(productAttributeValues).where(eq(productAttributeValues.productId, productId));
  const seen = new Set<number>();
  const values: {
    productId: number;
    attributeId: number;
    valueText: string | null;
    valueNum: string | null;
  }[] = [];
  for (const row of rows) {
    if (seen.has(row.attributeId)) continue;
    seen.add(row.attributeId);
    values.push({
      productId,
      attributeId: row.attributeId,
      valueText: row.valueText,
      valueNum: row.valueNum === null ? null : String(row.valueNum),
    });
  }
  if (values.length > 0) await db.insert(productAttributeValues).values(values);
}

export async function replaceRelations(
  db: Db,
  productId: number,
  rows: ProductRelationRow[],
): Promise<void> {
  await db.delete(productRelations).where(eq(productRelations.productId, productId));
  // DECISION: a self-relation (CHECK product_relations_not_self) and a repeated (relatedId, kind)
  // pair (the composite PK) are dropped rather than raised - the admin form can produce both and a
  // driver error would lose the whole save.
  const seen = new Set<string>();
  const values: { productId: number; relatedId: number; kind: ProductRelationRow["kind"]; sort: number }[] = [];
  for (const row of rows) {
    if (row.relatedId === productId) continue;
    const key = `${row.relatedId}:${row.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    values.push({ productId, relatedId: row.relatedId, kind: row.kind, sort: row.sort });
  }
  if (values.length > 0) await db.insert(productRelations).values(values);
}

export async function replaceCollections(
  db: Db,
  productId: number,
  collectionIds: number[],
): Promise<void> {
  await db.delete(collectionProducts).where(eq(collectionProducts.productId, productId));
  const unique = [...new Set(collectionIds)];
  if (unique.length === 0) return;
  // The given order is the merchandised order (collections.ts rules).
  await db
    .insert(collectionProducts)
    .values(unique.map((collectionId, index) => ({ collectionId, productId, sort: index })));
}

/**
 * `instalment_price` moves with `price` in the SAME statement - the instalment storefront must
 * never be able to observe a fixed price that has already changed next to a derived one that has
 * not. A row a human pinned (`instalment_price_manual`) keeps its value: the CASE is evaluated
 * against the flag as stored, so the decision lives in SQL rather than in a read-then-write race.
 */
export async function updatePrice(
  db: Db,
  id: number,
  price: number,
  compareAtPrice: number | null,
  _legacyRule?: InstalmentsRule,
): Promise<void> {
  await db
    .update(products)
    .set({
      price,
      compareAtPrice,
      priceUpdatedAt: sql`now()`,
    })
    .where(eq(products.id, id));
}

/**
 * Re-derive every NON-manual row after the panel's rule changes. One UPDATE, and deliberately no
 * `price_history` row: the fixed price did not move - only the presentation of a derived one.
 * Returns the number of rows that actually changed.
 */
export async function recomputeInstalmentPrices(db: Db, rule: InstalmentsRule): Promise<number> {
  // Derived by deriveInstalmentPrice, the one rule every other writer uses, then written back per chunk.
  // The rule has branches (commission or markup, a capped rounding step) that a SQL copy would have to
  // mirror, and a second copy is how two prices drift apart. The rows are locked while it runs so a
  // price saved in the meantime cannot be overwritten with a value derived from the old one.
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: products.id, price: products.price, instalmentPrice: products.instalmentPrice })
      .from(products)
      .where(eq(products.instalmentPriceManual, false))
      .orderBy(products.id)
      .for("update");
    const changed = rows
      .map((r) => ({ id: r.id, next: deriveInstalmentPrice(r.price, rule), prev: r.instalmentPrice }))
      .filter((r) => r.prev !== r.next);
    for (let i = 0; i < changed.length; i += 500) {
      const values = sql.join(changed.slice(i, i + 500).map((r) => sql`(${r.id}::int, ${r.next}::bigint)`), sql`, `);
      await tx.execute(sql`update products set instalment_price = v.p from (values ${values}) as v(id, p) where products.id = v.id and products.instalment_price_manual = false`);
    }
    return changed.length;
  });
}

export async function insertPriceHistory(
  db: Db,
  r: { productId: number; price: number; compareAtPrice: number | null; actor: Actor; note: string | null },
): Promise<void> {
  await db.insert(priceHistory).values({
    productId: r.productId,
    price: r.price,
    compareAtPrice: r.compareAtPrice,
    actorType: r.actor.type,
    actorId: r.actor.id,
    note: r.note,
  });
}

/** EDGE CASE: stock may go below zero only for a correction reason; oversell is caught at reserve. */
const NEGATIVE_STOCK_REASONS: ReadonlySet<MovementReason> = new Set<MovementReason>([
  "return",
  "cancel",
  "seed",
]);

export async function applyMovement(
  db: Db,
  r: {
    productId: number;
    delta: number;
    reason: MovementReason;
    actor: Actor;
    orderId: string | null;
    note: string | null;
  },
): Promise<{ stockQty: number; availableBefore: number; availableAfter: number }> {
  if (!Number.isSafeInteger(r.delta) || r.delta === 0) {
    // DECISION: `inventory_movements_delta_nonzero` is a CHECK; rejecting here keeps the caller's
    // transaction alive and returns a mapped AppError instead of a raw driver error.
    throw appError("VALIDATION", { details: { field: "delta", value: r.delta } });
  }

  // the spec: the row is locked first so two movements can never interleave their arithmetic.
  const [locked] = await db
    .select({
      stockPolicy: products.stockPolicy,
      stockQty: products.stockQty,
      allowBackorder: products.allowBackorder,
      reserved: reservedQtySql,
    })
    .from(products)
    .where(eq(products.id, r.productId))
    .limit(1)
    .for("update");
  if (locked === undefined) throw appError("NOT_FOUND", { details: { productId: r.productId } });

  if (
    locked.stockPolicy === "track" &&
    locked.stockQty + r.delta < 0 &&
    !NEGATIVE_STOCK_REASONS.has(r.reason)
  ) {
    throw appError("CONFLICT", {
      details: { productId: r.productId, stockQty: locked.stockQty, delta: r.delta, reason: r.reason },
    });
  }

  await db.insert(inventoryMovements).values({
    productId: r.productId,
    delta: r.delta,
    reason: r.reason,
    orderId: r.orderId,
    actorType: r.actor.type,
    actorId: r.actor.id,
    note: r.note,
  });

  // DECISION: the contract's third step ("UPDATE stock_qty = stock_qty + delta") is NOT issued
  // here. `stock_qty` is trigger-owned (`nl_apply_inventory_movement`, SECURITY DEFINER, in
  // migrations/0001_init.sql) and packages/db/roles.sql grants UPDATE(stock_qty) to no app role, so
  // repeating the update would double the delta and be refused by the grant. The row is re-read
  // inside the same lock instead.
  const [after] = await db
    .select({ stockQty: products.stockQty })
    .from(products)
    .where(eq(products.id, r.productId))
    .limit(1);

  const reserved = Number(locked.reserved);
  const stockQty = after?.stockQty ?? locked.stockQty + r.delta;
  return {
    stockQty,
    availableBefore: Math.max(0, locked.stockQty - reserved),
    availableAfter: Math.max(0, stockQty - reserved),
  };
}

export async function listPriceHistory(
  db: Db,
  productId: number,
  limit: number,
): Promise<PriceHistoryRow[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({
      id: priceHistory.id,
      productId: priceHistory.productId,
      price: priceHistory.price,
      compareAtPrice: priceHistory.compareAtPrice,
      actorType: priceHistory.actorType,
      actorId: priceHistory.actorId,
      note: priceHistory.note,
      createdAt: priceHistory.createdAt,
    })
    .from(priceHistory)
    .where(eq(priceHistory.productId, productId))
    .orderBy(desc(priceHistory.createdAt), desc(priceHistory.id))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    price: row.price,
    compareAtPrice: row.compareAtPrice,
    // The canonical PriceHistoryRow (../types) carries the composed `Actor`, not the two columns.
    actor: { type: row.actorType, id: row.actorId },
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listMovements(db: Db, productId: number, limit: number): Promise<MovementRow[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({
      delta: inventoryMovements.delta,
      reason: inventoryMovements.reason,
      orderId: inventoryMovements.orderId,
      note: inventoryMovements.note,
      createdAt: inventoryMovements.createdAt,
    })
    .from(inventoryMovements)
    .where(eq(inventoryMovements.productId, productId))
    .orderBy(desc(inventoryMovements.createdAt), desc(inventoryMovements.id))
    .limit(limit);
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

export async function soldQty90d(db: Db, ids: readonly number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  // EDGE CASE: "soldQty90d with [] → empty Map, no query".
  if (ids.length === 0) return out;
  const dims = [...new Set(ids)].map((id) => `product:${id}`);
  const rows = await db
    .select({ dim: metricsDaily.dim, sold: sql<string>`sum(${metricsDaily.value})` })
    .from(metricsDaily)
    .where(
      and(
        eq(metricsDaily.metric, "product.sold_qty"),
        inArray(metricsDaily.dim, dims),
        sql`${metricsDaily.day} >= (current_date - 90)`,
      ),
    )
    .groupBy(metricsDaily.dim);

  for (const row of rows) {
    const id = Number(row.dim.slice("product:".length));
    const sold = Number(row.sold);
    if (Number.isFinite(id) && Number.isFinite(sold)) out.set(id, sold);
  }
  return out;
}

export async function counts(db: Db): Promise<{ products: number; buyable: number; onSale: number }> {
  const [row] = await db
    .select({
      products: sql<number>`count(*)::int`,
      buyable: sql<number>`count(*) filter (where ${availableSql} and ${products.price} > 0)::int`,
      onSale: sql<number>`count(*) filter (where ${saleSql})::int`,
    })
    .from(products)
    .where(baseSql);
  return {
    products: Number(row?.products ?? 0),
    buyable: Number(row?.buyable ?? 0),
    onSale: Number(row?.onSale ?? 0),
  };
}

// ── facets ─────────────────────────────────────────────────────────────────────────────────────

const emptyFacetSources = (total: number): FacetSources => ({
  total,
  price: { min: 0, max: 0 },
  avail: { in: 0, sale: 0, ready: 0 },
  brands: [],
  collections: [],
  attributes: [],
});

/** The scope half of a list plan, without the shopper's filters (the spec: facets are per SCOPE). */
function scopeWhereSql(scope: ProductScope, now: Date): SQL {
  switch (scope.kind) {
    case "all":
      return baseSql;
    case "category":
      return sql`(${baseSql} and ${categoryTreeSql(scope.id === undefined ? [] : [scope.id])})`;
    case "brand":
      return sql`(${baseSql} and ${scope.id === undefined ? NEVER : sql`${products.brandId} = ${scope.id}`})`;
    case "collection":
      return sql`(${baseSql} and ${collectionScopeSql(scope.id === undefined ? [] : [scope.id])})`;
    case "sale":
      return sql`(${baseSql} and ${saleSql})`;
    case "new": {
      // list.NEW_SCOPE_DAYS === cards.NEW_DAYS === 30; the value is taken from ./cards because
      // importing it from ./list would close a runtime import cycle (list.ts imports this module).
      const since = new Date(now.getTime() - NEW_DAYS * 86_400_000);
      // Same as the `new` WhereTerm above: the driver wants a string, never a Date.
      return sql`(${baseSql} and ${products.publishedAt} is not null and ${products.publishedAt} >= ${since.toISOString()})`;
    }
    case "gifts":
      return sql`(${baseSql} and ${giftScopeSql})`;
    case "ids": {
      const ids = scope.ids ?? [];
      return sql`(${baseSql} and ${ids.length === 0 ? NEVER : sql`${products.id} in (${idList(ids)})`})`;
    }
  }
}

type AttributeSourceRaw = {
  key: string;
  label: string;
  unit: string | null;
  kind: AttributeKind;
  sort: number;
  value: string;
  valueLabel: string | null;
  count: number;
  hex: string | null;
  swatchMediaId: string | null;
};

export async function queryFacetSources(db: Db, scope: ProductScope): Promise<FacetSources> {
  // facets.ts short-circuits the "ids" scope (compare / wishlist never show filters); the
  // repository agrees so a stray call costs no round trip.
  if (scope.kind === "ids") return emptyFacetSources(new Set(scope.ids ?? []).size);

  const where = scopeWhereSql(scope, new Date());

  const [totalsRows, brandRows, collectionRows, attributeRows] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)::int`,
        priceMin: sql<string>`coalesce(min(${products.price}) filter (where ${products.price} > 0), 0)::bigint`,
        priceMax: sql<string>`coalesce(max(${products.price}) filter (where ${products.price} > 0), 0)::bigint`,
        availIn: sql<number>`count(*) filter (where ${availableSql})::int`,
        availSale: sql<number>`count(*) filter (where ${saleSql})::int`,
        availReady: sql<number>`count(*) filter (where ${availableSql} and ${products.price} > 0)::int`,
      })
      .from(products)
      .where(where),
    db
      .select({
        id: brands.id,
        slug: brands.slug,
        name: brands.nameFa,
        count: sql<number>`count(*)::int`,
      })
      .from(products)
      .innerJoin(brands, eq(brands.id, products.brandId))
      .where(where)
      .groupBy(brands.id, brands.slug, brands.nameFa)
      // facets.ts rules: brand options are sorted by count desc, then name.
      .orderBy(sql`count(*) desc`, asc(brands.nameFa)),
    db.execute(sql`
      select c.id as "id", c.slug as "slug", c.name as "name", c.kind::text as "kind",
             c.sort as "sort", count(*)::int as "count"
      from ${products}
      join collections c
        on c.kind in ('group', 'sub') and c.status = 'active' and ${collectionMemberSql}
      where ${where}
      group by c.id, c.slug, c.name, c.kind, c.sort
      order by c.sort, c.name
    `) as unknown as Promise<FacetCollectionSource[]>,
    db.execute(sql`
      select * from (
        select a.key as "key", a.label as "label", a.unit as "unit", a.kind::text as "kind",
               a.sort as "sort", ${attrValueKeySql} as "value",
               (array_agg(pav.value_text order by ${products.id}) filter (where pav.value_text is not null))[1] as "valueLabel",
               count(*)::int as "count",
               (array_agg(${products.colorHex} order by ${products.id}) filter (where ${products.colorHex} is not null))[1] as "hex",
               (array_agg(${products.swatchMediaId} order by ${products.id}) filter (where ${products.swatchMediaId} is not null))[1] as "swatchMediaId"
        from ${products}
        join product_attribute_values pav on pav.product_id = ${PRODUCT_ID}
        join attributes a on a.id = pav.attribute_id
        where a.is_filterable and ${where}
        group by 1, 2, 3, 4, 5, 6
      ) facet
      where facet."value" <> ''
      order by facet."sort", facet."key", facet."count" desc, facet."value"
    `) as unknown as Promise<AttributeSourceRaw[]>,
  ]);

  const totals = totalsRows[0];
  const swatchRows = await loadMediaByIds(
    db,
    attributeRows.map((r) => r.swatchMediaId).filter((id): id is string => id !== null),
  );

  return {
    total: Number(totals?.total ?? 0),
    price: { min: Number(totals?.priceMin ?? 0), max: Number(totals?.priceMax ?? 0) },
    avail: {
      in: Number(totals?.availIn ?? 0),
      sale: Number(totals?.availSale ?? 0),
      ready: Number(totals?.availReady ?? 0),
    },
    brands: brandRows.map((b) => ({ ...b, count: Number(b.count) })),
    collections: collectionRows.map((c) => ({ ...c, sort: Number(c.sort), count: Number(c.count) })),
    attributes: attributeRows.map((a): FacetAttributeSource => {
      const swatchRow = a.swatchMediaId === null ? undefined : swatchRows.get(a.swatchMediaId);
      const label = a.valueLabel === null || a.valueLabel.trim() === "" ? a.value : a.valueLabel.trim();
      return {
        key: a.key,
        label: a.label,
        unit: a.unit,
        kind: a.kind,
        sort: Number(a.sort),
        value: a.value,
        valueLabel: label,
        count: Number(a.count),
        hex: a.hex,
        swatch: swatchRow === undefined ? null : toImageRef(toMediaRowLike(swatchRow), { altFallback: label }),
      };
    }),
  };
}

// ── admin list / price scope (M5) ────────────────────────────────────────────────────────────────
// DECISION (M5): the admin product list, bulk-price scope resolution and price-row fetch have no
// storefront equivalent (queryCards carries the public `baseSql` term, which the admin must NOT
// apply - drafts/hidden rows are edited and priced too). the spec keeps SQL in repo.ts, so these
// admin reads live here. Archived rows are excluded unless `status: "archived"` is asked for.

export type AdminSort = "updated" | "price_asc" | "price_desc" | "name" | "stock_asc";

export type AdminProductFilter = {
  q?: string;
  brandId?: number;
  categoryIds?: number[];
  collectionId?: number;
  modelId?: number;
  status?: "draft" | "active" | "archived";
  stockState?: "in" | "out" | "low" | "backorder";
  priceState?: "priced" | "on_request" | "sale";
  missing?: "image" | "description" | "spec" | "seo";
  /** Only what the instalment storefront may sell (a staff member confined to that site). */
  instalmentEligible?: boolean;
  sort?: AdminSort;
  page?: number;
  pageSize?: number;
};

export type AdminListRow = {
  id: number;
  slug: string;
  displayName: string;
  brandName: string | null;
  modelCode: string | null;
  price: number;
  compareAtPrice: number | null;
  /** The price the instalment storefront shows (null until one has been derived). */
  instalmentPrice: number | null;
  instalmentEligible: boolean;
  isOnRequest: boolean;
  status: "draft" | "active" | "archived";
  visibility: "public" | "hidden" | "link_only";
  stockPolicy: "track" | "untracked";
  stockQty: number;
  reservedQty: number;
  available: number;
  lowStockThreshold: number;
  allowBackorder: boolean;
  imageKey: string | null;
  updatedAt: string;
};

export type AdminPriceRow = {
  id: number;
  displayName: string;
  price: number;
  compareAtPrice: number | null;
  priceBasis: "manual" | "fx";
  status: "draft" | "active" | "archived";
  isOnRequest: boolean;
};

const availableCountSql = sql<number>`(${products.stockQty} - ${reservedQtySql})`;

/**
 * LIKE needle for the admin search box. `products.search_text` is
 * `nl_fa_norm(concat_ws(' ', display_name, name, sku, model_code, color_name))` and `faNorm` is
 * that SQL function's TypeScript twin, so folding the typed text with `faNorm` puts both sides of
 * the comparison into the same alphabet: an Arabic-yeh (ي) query matches a Persian-yeh (ی) name,
 * Persian and Arabic-Indic digits match Latin ones, and ZWNJ/whitespace spellings collide.
 * `%`, `_` and `\` are escaped, so the operator's text is a literal - typing `%` searches for a
 * per-cent sign instead of matching every row.
 */
function adminSearchNeedle(q: string): string {
  return `%${faNorm(q.trim()).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * WHERE terms of the admin list. `queryAdmin` (the page) and `adminProductIds` (the bulk-price
 * scope) must resolve the same rows, so both build their predicate here and nowhere else.
 */
function adminWhereTerms(f: AdminProductFilter): SQL[] {
  const terms: SQL[] = [];
  terms.push(f.status === undefined ? sql`${products.status} <> 'archived'` : sql`${products.status} = ${f.status}`);
  if (f.q !== undefined && f.q.trim() !== "") {
    // DECISION: the text query is matched against the generated, already-normalised `search_text`
    // (display name, name, sku, model code, colour) instead of raw ILIKE on each column - the raw
    // form made «يخچال»/«یخچال» and «۱۲۳»/«123» disagree with what the column holds. `slug` is not
    // part of search_text (CSV export and the storefront address a product by slug) and is already
    // lowercase ASCII, so it takes the same needle; both sides are folded to lowercase, which is
    // why plain LIKE is exact here and can use products_search_text_trgm_idx.
    const needle = adminSearchNeedle(f.q);
    terms.push(sql`(${products.searchText} like ${needle} or ${products.slug} like ${needle})`);
  }
  if (f.brandId !== undefined) terms.push(sql`${products.brandId} = ${f.brandId}`);
  if (f.modelId !== undefined) terms.push(sql`${products.modelId} = ${f.modelId}`);
  if (f.categoryIds !== undefined && f.categoryIds.length > 0) {
    terms.push(
      sql`exists (select 1 from product_categories pc where pc.product_id = ${PRODUCT_ID} and pc.category_id in (${sql.join(
        f.categoryIds.map((id) => sql`${id}`),
        sql`, `,
      )}))`,
    );
  }
  if (f.collectionId !== undefined) {
    terms.push(
      sql`exists (select 1 from collection_products cp where cp.product_id = ${PRODUCT_ID} and cp.collection_id = ${f.collectionId})`,
    );
  }
  if (f.stockState === "in") terms.push(availableSql);
  else if (f.stockState === "out") terms.push(sql`not ${availableSql}`);
  else if (f.stockState === "low")
    terms.push(
      sql`(${products.stockPolicy} = 'track' and ${availableCountSql} >= 1 and ${availableCountSql} <= ${products.lowStockThreshold})`,
    );
  else if (f.stockState === "backorder") terms.push(sql`(${products.allowBackorder} and ${availableCountSql} < 1)`);
  if (f.priceState === "priced") terms.push(sql`(${products.price} > 0 and not ${saleSql})`);
  else if (f.priceState === "on_request") terms.push(sql`${products.price} = 0`);
  else if (f.priceState === "sale") terms.push(saleSql);
  if (f.missing === "image") terms.push(sql`not ${hasImageSql}`);
  else if (f.missing === "description") terms.push(sql`${products.descriptionHtml} = ''`);
  else if (f.missing === "spec")
    terms.push(sql`not exists (select 1 from product_specs ps where ps.product_id = ${PRODUCT_ID})`);
  else if (f.missing === "seo") terms.push(sql`${products.seoTitle} is null`);
  if (f.instalmentEligible === true) terms.push(sql`${products.instalmentEligible}`);
  return terms;
}

/** The terms above as one predicate; every admin read goes through this. */
function adminWhere(f: AdminProductFilter): SQL {
  return sql.join(adminWhereTerms(f), sql` and `);
}

function adminOrderBy(sort: AdminSort | undefined): SQL {
  switch (sort) {
    case "price_asc":
      return sql`${products.price} asc, ${products.id} desc`;
    case "price_desc":
      return sql`${products.price} desc, ${products.id} desc`;
    case "name":
      return sql`${products.displayName} asc`;
    case "stock_asc":
      return sql`${availableCountSql} asc, ${products.id} desc`;
    case "updated":
    case undefined:
      return sql`${products.updatedAt} desc, ${products.id} desc`;
  }
}

export const primaryImageKeySql = sql<
  string | null
>`(select m.storage_key from product_images pim join media m on m.id = pim.media_id where pim.product_id = ${PRODUCT_ID} order by (case when pim.role = 'primary' then 0 else 1 end), pim.sort asc limit 1)`;

export async function queryAdmin(
  db: Db,
  filter: AdminProductFilter,
): Promise<{ rows: AdminListRow[]; total: number }> {
  const page = Math.max(1, Math.trunc(filter.page ?? 1));
  const pageSize = [50, 100, 200].includes(filter.pageSize ?? 50) ? (filter.pageSize ?? 50) : 50;
  // One offset feeds both the page read and the "past the end?" test below, so the fallback count
  // can never be asked about a different window than the one the rows were read from.
  const offset = (page - 1) * pageSize;
  const where = adminWhere(filter);
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      displayName: products.displayName,
      brandName: brands.nameFa,
      modelCode: products.modelCode,
      price: products.price,
      compareAtPrice: products.compareAtPrice,
      instalmentPrice: products.instalmentPrice,
      instalmentEligible: products.instalmentEligible,
      isOnRequest: products.isOnRequest,
      status: products.status,
      visibility: products.visibility,
      stockPolicy: products.stockPolicy,
      stockQty: products.stockQty,
      reservedQty: sql<number>`${reservedQtySql}`,
      lowStockThreshold: products.lowStockThreshold,
      allowBackorder: products.allowBackorder,
      imageKey: primaryImageKeySql,
      updatedAt: products.updatedAt,
      total: sql<number>`cast(count(*) over () as int)`,
    })
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(where)
    .orderBy(adminOrderBy(filter.sort))
    .limit(pageSize)
    .offset(offset);

  // A window function reports nothing when its window is empty, so a page past the last one came
  // back as `total: 0` - the admin pager then showed an empty result as "no products". Only that
  // one case pays for a second statement; the count drops the brands join, which cannot change the
  // row count (it is on the joined table's primary key). Page 1 of an empty result stays one query.
  let total = rows.length > 0 ? Number(rows[0]?.total ?? 0) : 0;
  if (rows.length === 0 && offset > 0) {
    const counted = await db
      .select({ total: sql<number>`cast(count(*) as int)` })
      .from(products)
      .where(where);
    total = Number(counted[0]?.total ?? 0);
  }
  const items: AdminListRow[] = rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    displayName: r.displayName,
    brandName: r.brandName ?? null,
    modelCode: r.modelCode,
    price: r.price,
    compareAtPrice: r.compareAtPrice,
    instalmentPrice: r.instalmentPrice === null ? null : Number(r.instalmentPrice),
    instalmentEligible: r.instalmentEligible,
    isOnRequest: r.isOnRequest,
    status: r.status,
    visibility: r.visibility,
    stockPolicy: r.stockPolicy,
    stockQty: r.stockQty,
    reservedQty: Number(r.reservedQty ?? 0),
    available: r.stockQty - Number(r.reservedQty ?? 0),
    lowStockThreshold: r.lowStockThreshold,
    allowBackorder: r.allowBackorder,
    imageKey: r.imageKey ?? null,
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
  }));
  return { rows: items, total };
}

export async function adminProductIds(db: Db, filter: AdminProductFilter): Promise<number[]> {
  // Exactly the list's predicate (adminWhere), so "select all matching" is the page's whole result
  // set - the same rows, not a differently-filtered approximation of them.
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(adminWhere(filter))
    .orderBy(asc(products.id));
  return rows.map((r) => r.id);
}

export async function priceRowsForIds(db: Db, ids: number[]): Promise<AdminPriceRow[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: products.id,
      displayName: products.displayName,
      price: products.price,
      compareAtPrice: products.compareAtPrice,
      priceBasis: products.priceBasis,
      status: products.status,
      isOnRequest: products.isOnRequest,
    })
    .from(products)
    .where(and(inArray(products.id, ids), ne(products.status, "archived")));
  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    price: r.price,
    compareAtPrice: r.compareAtPrice,
    priceBasis: r.priceBasis,
    status: r.status,
    isOnRequest: r.isOnRequest,
  }));
}

export async function productIdsByBrand(db: Db, brandId: number): Promise<number[]> {
  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.brandId, brandId), ne(products.status, "archived")));
  return rows.map((r) => r.id);
}

export async function productIdsInCategories(db: Db, categoryIds: number[]): Promise<number[]> {
  if (categoryIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ id: productCategories.productId })
    .from(productCategories)
    .innerJoin(products, eq(products.id, productCategories.productId))
    .where(and(inArray(productCategories.categoryId, categoryIds), ne(products.status, "archived")));
  return rows.map((r) => r.id);
}

/** Sets status without touching price/stock; used by archive/unarchive (models primary repointed by callers). */
export async function setProductStatus(db: Db, id: number, status: "draft" | "active" | "archived"): Promise<void> {
  await db.update(products).set({ status }).where(eq(products.id, id));
}
