import { and, eq, getTableColumns, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  pgView,
  primaryKey,
  serial,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffUsers } from "./auth";
import { createdAt, money, tstz, ulid, updatedAt } from "./columns";
import {
  actorType,
  attributeKind,
  categoryStatus,
  collectionKind,
  collectionStatus,
  mediaKind,
  mediaSource,
  priceBasis,
  productImageRole,
  productRelationKind,
  productStatus,
  productVisibility,
  stockPolicy,
} from "./enums";

// ── jsonb shapes ───────────────────────────────────────────────────────────────────────────────

/** collections.rule_json - the spec */
export type CollectionRule = {
  brandIds?: number[];
  categoryIds?: number[];
  priceMin?: number;
  priceMax?: number;
  onSale?: boolean;
  inStock?: boolean;
  tags?: string[];
};

/** media.renditions_json - the spec: {avif:{320:'key',480:…}, webp:{…}, master:'key'} */
export type MediaRenditions = {
  master: string;
  avif?: Record<string, string>;
  webp?: Record<string, string>;
  jpeg?: Record<string, string>;
};

/** media.normalize_json - the spec / v2 §5.1 */
export type MediaNormalizeInfo = {
  subjectH?: number;
  widthBound?: boolean;
  quarantined?: boolean;
  reason?: string | null;
  bbox?: [number, number, number, number];
  edgeSat?: number;
};

// ── media ──────────────────────────────────────────────────────────────────────────────────────

export const media = pgTable(
  "media",
  {
    id: ulid("id").primaryKey(),
    kind: mediaKind("kind").notNull(),
    storageKey: text("storage_key").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    alt: text("alt").notNull().default(""),
    lqip: text("lqip"),
    renditionsJson: jsonb("renditions_json").$type<MediaRenditions>(),
    normalizeJson: jsonb("normalize_json").$type<MediaNormalizeInfo>(),
    uploadedByStaffId: ulid("uploaded_by_staff_id").references(() => staffUsers.id, { onDelete: "set null" }),
    source: mediaSource("source").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("media_storage_key_uq").on(t.storageKey),
    index("media_kind_idx").on(t.kind),
    index("media_source_idx").on(t.source),
    index("media_created_at_idx").on(t.createdAt),
    check("media_bytes_nonneg", sql`bytes >= 0`),
  ],
);

// ── brands ─────────────────────────────────────────────────────────────────────────────────────

export const brands = pgTable(
  "brands",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    nameFa: text("name_fa").notNull(),
    nameEn: text("name_en").notNull(),
    logoMediaId: ulid("logo_media_id").references(() => media.id),
    storyHtml: text("story_html"),
    claim: text("claim"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    robots: text("robots").notNull().default("index, follow"),
    legacyLastmod: tstz("legacy_lastmod"),
    isActive: boolean("is_active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("brands_slug_uq").on(t.slug),
    index("brands_active_sort_idx").on(t.isActive, t.sort),
  ],
);

// ── categories (legacy WP product categories, URL-bearing) ─────────────────────────────────────

export const categories = pgTable(
  "categories",
  {
    id: serial("id").primaryKey(),
    parentId: integer("parent_id").references((): AnyPgColumn => categories.id),
    slug: text("slug").notNull(),
    path: text("path").notNull(),
    name: text("name").notNull(),
    descriptionHtml: text("description_html"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    robots: text("robots").notNull().default("index, follow"),
    inSitemap: boolean("in_sitemap").notNull().default(true),
    legacyLastmod: tstz("legacy_lastmod"),
    status: categoryStatus("status").notNull().default("active"),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("categories_path_uq").on(t.path),
    unique("categories_parent_slug_uq").on(t.parentId, t.slug).nullsNotDistinct(),
    index("categories_parent_id_idx").on(t.parentId),
    index("categories_status_sort_idx").on(t.status, t.sort),
  ],
);

// ── collections (human browse taxonomy + campaigns) ────────────────────────────────────────────

export const collections = pgTable(
  "collections",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(),
    parentId: integer("parent_id").references((): AnyPgColumn => collections.id),
    name: text("name").notNull(),
    kind: collectionKind("kind").notNull(),
    ruleJson: jsonb("rule_json").$type<CollectionRule>(),
    coverMediaId: ulid("cover_media_id").references(() => media.id),
    coverDarkMediaId: ulid("cover_dark_media_id").references(() => media.id),
    descriptionHtml: text("description_html"),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    isNav: boolean("is_nav").notNull().default(false),
    startsAt: tstz("starts_at"),
    endsAt: tstz("ends_at"),
    status: collectionStatus("status").notNull().default("draft"),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("collections_slug_uq").on(t.slug),
    index("collections_parent_id_idx").on(t.parentId),
    index("collections_status_kind_sort_idx").on(t.status, t.kind, t.sort),
    check("collections_window_valid", sql`starts_at is null or ends_at is null or starts_at < ends_at`),
  ],
);

export const collectionProducts = pgTable(
  "collection_products",
  {
    collectionId: integer("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.productId] }),
    index("collection_products_product_id_idx").on(t.productId),
  ],
);

// ── product_models (variant grouping: one card, many colours) ──────────────────────────────────

export const productModels = pgTable(
  "product_models",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    displayName: text("display_name").notNull(),
    brandId: integer("brand_id").references(() => brands.id),
    primaryProductId: integer("primary_product_id").references((): AnyPgColumn => products.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("product_models_key_uq").on(t.key),
    index("product_models_brand_id_idx").on(t.brandId),
  ],
);

// ── products ───────────────────────────────────────────────────────────────────────────────────

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    modelId: integer("model_id").references((): AnyPgColumn => productModels.id, { onDelete: "set null" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    displayName: text("display_name").notNull(),
    brandId: integer("brand_id").references(() => brands.id),
    sku: text("sku"),
    modelCode: text("model_code"),
    colorName: text("color_name"),
    colorHex: text("color_hex"),
    swatchMediaId: ulid("swatch_media_id").references(() => media.id),
    status: productStatus("status").notNull().default("draft"),
    visibility: productVisibility("visibility").notNull().default("public"),
    price: money("price").notNull().default(0),
    compareAtPrice: money("compare_at_price"),
    costPrice: money("cost_price"),
    // The price the instalment storefront shows. SnappPay takes a commission from the merchant, so
    // it is derived from `price` (core/pricing/instalments.deriveInstalmentPrice) on every price
    // write - unless a human pinned it, which is what `instalment_price_manual` records. Null means
    // "never derived yet"; the resolver reads it as 0 = on request, exactly like price 0.
    instalmentPrice: money("instalment_price"),
    instalmentPriceManual: boolean("instalment_price_manual").notNull().default(false),
    // May this product be bought in instalments (SnappPay, the instalment storefront)? The admin's
    // per-product switch. Default true: every product that existed before the switch keeps the
    // availability it had. Card purchase on the main site never reads it.
    instalmentEligible: boolean("instalment_eligible").notNull().default(true),
    priceBasis: priceBasis("price_basis").notNull().default("manual"),
    basePrice: numeric("base_price"),
    baseCurrency: text("base_currency"),
    priceUpdatedAt: tstz("price_updated_at"),
    stockPolicy: stockPolicy("stock_policy").notNull().default("track"),
    stockQty: integer("stock_qty").notNull().default(0),
    allowBackorder: boolean("allow_backorder").notNull().default(false),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(3),
    maxPerOrder: integer("max_per_order").notNull().default(5),
    shortHtml: text("short_html"),
    descriptionHtml: text("description_html"),
    warrantyMonths: integer("warranty_months"),
    warrantyText: text("warranty_text"),
    weightG: integer("weight_g"),
    lengthMm: integer("length_mm"),
    widthMm: integer("width_mm"),
    heightMm: integer("height_mm"),
    videoMediaId: ulid("video_media_id").references(() => media.id),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    robots: text("robots").notNull().default("index, follow"),
    legacyLastmod: tstz("legacy_lastmod"),
    ratingAvg: numeric("rating_avg", { precision: 3, scale: 2 }).notNull().default("0"),
    ratingCount: integer("rating_count").notNull().default(0),
    viewCount: bigint("view_count", { mode: "number" }).notNull().default(0),
    isOnRequest: boolean("is_on_request")
      .notNull()
      .generatedAlwaysAs(sql`price = 0`),
    searchText: text("search_text")
      .notNull()
      .generatedAlwaysAs(sql`nl_fa_norm(concat_ws(' ', display_name, name, sku, model_code, color_name))`),
    publishedAt: tstz("published_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("products_slug_uq").on(t.slug),
    index("products_search_text_trgm_idx").using("gin", t.searchText.op("gin_trgm_ops")),
    index("products_brand_id_idx").on(t.brandId),
    index("products_model_id_idx").on(t.modelId),
    index("products_status_visibility_idx").on(t.status, t.visibility),
    index("products_price_idx").on(t.price),
    index("products_instalment_price_idx").on(t.instalmentPrice),
    index("products_sku_idx").on(t.sku),
    index("products_published_at_idx").on(t.publishedAt),
    index("products_updated_at_idx").on(t.updatedAt),
    check("products_price_nonneg", sql`price >= 0`),
    check("products_compare_at_nonneg", sql`compare_at_price is null or compare_at_price >= 0`),
    check("products_instalment_price_nonneg", sql`instalment_price is null or instalment_price >= 0`),
    check("products_cost_nonneg", sql`cost_price is null or cost_price >= 0`),
    check("products_max_per_order_pos", sql`max_per_order >= 1`),
    check("products_low_stock_nonneg", sql`low_stock_threshold >= 0`),
    check("products_rating_range", sql`rating_avg >= 0 and rating_avg <= 5`),
  ],
);

/**
 * The column set the storefront (role nl_web) is allowed to read - everything except cost_price.
 * roles.sql grants nl_web column-level SELECT on exactly these columns.
 */
const { costPrice: _costPrice, ...productWebColumnsRest } = getTableColumns(products);
void _costPrice;
export const productWebColumns = productWebColumnsRest;

// ── product ↔ category / images / specs / attributes / relations ───────────────────────────────

export const productCategories = pgTable(
  "product_categories",
  {
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.categoryId] }),
    index("product_categories_category_id_idx").on(t.categoryId),
    uniqueIndex("product_categories_primary_uq").on(t.productId).where(sql`is_primary`),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    mediaId: ulid("media_id")
      .notNull()
      .references(() => media.id),
    role: productImageRole("role").notNull().default("gallery"),
    sort: integer("sort").notNull().default(0),
    alt: text("alt").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    index("product_images_product_sort_idx").on(t.productId, t.sort),
    index("product_images_media_id_idx").on(t.mediaId),
    uniqueIndex("product_images_primary_uq").on(t.productId).where(sql`role = 'primary'`),
  ],
);

export const productSpecs = pgTable(
  "product_specs",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    groupName: text("group_name"),
    label: text("label").notNull(),
    value: text("value").notNull(),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("product_specs_product_sort_idx").on(t.productId, t.sort)],
);

export const attributes = pgTable(
  "attributes",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    unit: text("unit"),
    kind: attributeKind("kind").notNull().default("text"),
    isFilterable: boolean("is_filterable").notNull().default(false),
    isComparable: boolean("is_comparable").notNull().default(false),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("attributes_key_uq").on(t.key), index("attributes_sort_idx").on(t.sort)],
);

export const productAttributeValues = pgTable(
  "product_attribute_values",
  {
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    attributeId: integer("attribute_id")
      .notNull()
      .references(() => attributes.id, { onDelete: "cascade" }),
    valueText: text("value_text"),
    valueNum: numeric("value_num"),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.attributeId] }),
    index("product_attribute_values_attr_text_idx").on(t.attributeId, t.valueText),
    index("product_attribute_values_attr_num_idx").on(t.attributeId, t.valueNum),
  ],
);

export const productRelations = pgTable(
  "product_relations",
  {
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    relatedId: integer("related_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    kind: productRelationKind("kind").notNull(),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.relatedId, t.kind] }),
    index("product_relations_related_id_idx").on(t.relatedId),
    check("product_relations_not_self", sql`product_id <> related_id`),
  ],
);

// ── price_history (append-only) ────────────────────────────────────────────────────────────────

export const priceHistory = pgTable(
  "price_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    price: money("price").notNull(),
    compareAtPrice: money("compare_at_price"),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("price_history_product_created_idx").on(t.productId, t.createdAt)],
);

// ── view: brand product counts ──────────────────────────────

export const brandProductCounts = pgView("brand_product_counts").as((qb) =>
  qb
    .select({
      brandId: products.brandId,
      total: sql<number>`count(*)::int`.as("total"),
      buyable: sql<number>`count(*) filter (where ${products.price} > 0 and ${products.stockQty} > 0)::int`.as(
        "buyable",
      ),
    })
    .from(products)
    .where(and(eq(products.status, "active"), eq(products.visibility, "public")))
    .groupBy(products.brandId),
);
