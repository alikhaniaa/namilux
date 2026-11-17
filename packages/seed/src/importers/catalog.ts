import { faNorm, faZwnj } from "@namilux/core/persian";
// The instalment storefront lists a grossed-up price; an imported row gets it from the DEFAULT rule
// so the second site is priced from the first run (the panel re-derives every non-manual row when
// the commission or the rounding step changes).
import { DEFAULT_INSTALMENTS_RULE, deriveInstalmentPrice } from "@namilux/core/pricing/instalments";
import {
  and,
  attributes as attributesTable,
  brands as brandsTable,
  categories as categoriesTable,
  collectionProducts as collectionProductsTable,
  collections as collectionsTable,
  eq,
  getTableColumns,
  inArray,
  inventoryMovements as inventoryMovementsTable,
  priceHistory as priceHistoryTable,
  productAttributeValues as productAttributeValuesTable,
  productCategories as productCategoriesTable,
  productModels as productModelsTable,
  productSpecs as productSpecsTable,
  products as productsTable,
  sql,
  type SQL,
  type Table,
} from "@namilux/db";
import type { SeedContext } from "../context.js";
import { readLegacyBrands, type BrandSeed } from "../extract/brands.js";
import { CATEGORY_PATH_REDIRECTED_TO_BRAND, readLegacyCategories, type LegacyCategory } from "../extract/categories.js";
import { readCuratedCollections } from "../extract/collections.js";
import type { LegacyProduct } from "../extract/products.js";
import { readLegacyProducts } from "../extract/products.js";
import { readSeoLive, readSitemap, seoFieldsFor } from "../extract/seo.js";
import { COLOR_ATTRIBUTE, canonicalColorName, colorFromName, readColorTerms } from "../extract/taxonomy.js";
import { buildDisplayName, nameLooksLikeScrape } from "../transform/display-name.js";
import { extractModelCode, groupByModelKey, modelKey } from "../transform/model-key.js";
import { sanitizeLegacyHtml } from "../transform/sanitize.js";
import { brandPath, productPath } from "../transform/slugs.js";
import { dimsFromSpecs, specsFromAttributes, type SpecRow } from "../transform/specs.js";
import { inChunks } from "../idempotency.js";
import { warn } from "../report.js";

/** the spec: the Store API exposes `is_in_stock` but no quantity, so an in-stock product opens at 1. */
export const STOCK_QTY_WHEN_UNKNOWN = 1;

/** Rows per INSERT … VALUES batch (idempotency.inChunks default). */
const CHUNK = 200;

/** The curated sub label that means «no type yet» - never used as a display-name type. */
const CURATED_NEEDS_REVIEW = ["Needs review", "نیازمند بررسی"];

/**
 * `set` clause for an upsert, built from the table's own column metadata. The strings come from the
 * Drizzle schema, never from data, so this is not "string-built SQL from input".
 */
function excludedSet<T extends Table>(table: T, keys: readonly string[]): Record<string, SQL> {
  const cols = getTableColumns(table) as unknown as Record<string, { name: string }>;
  const out: Record<string, SQL> = {};
  for (const key of keys) {
    const col = cols[key];
    if (col === undefined) throw new Error(`unknown column ${key}`);
    out[key] = sql.raw(`excluded."${col.name}"`);
  }
  return out;
}

/**
 * Legacy ids are inserted verbatim, so the serial sequence must be moved past them before any new
 * row is allocated (the spec: "New rows continue the sequence").
 */
export async function syncSequence(ctx: SeedContext, table: string, column = "id"): Promise<void> {
  if (ctx.dry) return;
  try {
    await ctx.db.execute(
      sql`select setval(
            pg_get_serial_sequence(${table}, ${column}),
            greatest((select coalesce(max(id), 0) from ${sql.identifier(table)}), 1),
            true)`,
    );
  } catch (err) {
    // the spec grants nl_admin only USAGE+SELECT on sequences, and `setval` needs UPDATE. The import is
    // unaffected (every legacy id is explicit); only a LATER admin insert could collide with a legacy
    // id, so this is reported instead of failing the seed. Owner fix: run the setval as nl_migrate.
    warn(
      ctx.report,
      `${table} id sequence not advanced past the legacy ids (${err instanceof Error ? err.message : String(err)})`,
    );
  }
}

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Category descriptions are legacy Store-API HTML: sanitized at write, images dropped. */
function sanitizeStatic(html: string | null, siteOrigin: string): string | null {
  if (!html || !html.trim()) return null;
  const out = sanitizeLegacyHtml(html, { resolveImage: () => null, siteOrigin, allowImages: false });
  return out.html.trim() || null;
}

// ── brands ─────────────────────────────────────────────────────────────────────────────────────

async function importBrands(ctx: SeedContext, seo: SeoMaps): Promise<Map<string, BrandRow>> {
  const seeds = await readLegacyBrands(ctx.extractDir);
  const row = (b: BrandSeed): Record<string, unknown> => {
    const fields = seoFieldsFor(brandPath(b.slug), seo.live, seo.sitemap);
    return {
      slug: b.slug,
      nameFa: faZwnj(b.nameFa),
      nameEn: b.nameEn,
      claim: b.claim || null,
      seoTitle: fields.seoTitle,
      seoDescription: fields.seoDescription,
      robots: fields.robots,
      legacyLastmod: toDate(fields.legacyLastmod),
      // the spec §M0 OPEN(owner) → default active: zero-buyable brands get the coming-soon treatment in
      // the UI, never deactivation (a deactivated brand would 404 a contract URL).
      isActive: true,
      sort: b.sort,
    };
  };
  const set = excludedSet(brandsTable, [
    "nameFa",
    "nameEn",
    "claim",
    "seoTitle",
    "seoDescription",
    "robots",
    "legacyLastmod",
    "isActive",
    "sort",
  ]);

  const legacy = seeds.filter((b) => b.legacyId !== null).map((b) => ({ id: b.legacyId as number, ...row(b) }));
  const fresh = seeds.filter((b) => b.legacyId === null).map((b) => row(b));

  if (!ctx.dry) {
    await ctx.db.transaction(async (tx) => {
      await tx.insert(brandsTable).values(legacy as never).onConflictDoUpdate({ target: brandsTable.slug, set });
    });
    // New brands take serial ids AFTER the legacy block (24…197) so nothing collides.
    await syncSequence(ctx, "brands");
    await ctx.db.transaction(async (tx) => {
      await tx.insert(brandsTable).values(fresh as never).onConflictDoUpdate({ target: brandsTable.slug, set });
    });
  }

  ctx.report.brands = seeds.length;
  const byId = new Map<string, BrandRow>();
  if (ctx.dry) {
    seeds.forEach((b, i) => byId.set(b.slug, { id: b.legacyId ?? -(i + 1), slug: b.slug, nameFa: b.nameFa }));
    return byId;
  }
  const rows = await ctx.db
    .select({ id: brandsTable.id, slug: brandsTable.slug, nameFa: brandsTable.nameFa })
    .from(brandsTable);
  for (const r of rows) byId.set(r.slug, r);
  return byId;
}

type BrandRow = { id: number; slug: string; nameFa: string };
type SeoMaps = { live: Awaited<ReturnType<typeof readSeoLive>>; sitemap: Awaited<ReturnType<typeof readSitemap>> };

// ── categories ─────────────────────────────────────────────────────────────────────────────────

async function importCategories(ctx: SeedContext, seo: SeoMaps): Promise<LegacyCategory[]> {
  const { categories, collisions, warnings } = await readLegacyCategories(ctx.extractDir);
  for (const w of warnings) warn(ctx.report, w);
  ctx.report.slugCollisions = collisions;

  const rows = categories.map((c) => {
    const fields = seoFieldsFor(c.path, seo.live, seo.sitemap);
    return {
      id: c.id,
      parentId: c.parentId,
      slug: c.slug,
      path: c.dbPath,
      name: faZwnj(c.name),
      descriptionHtml: sanitizeStatic(c.descriptionHtml, ctx.siteOrigin),
      seoTitle: fields.seoTitle,
      seoDescription: fields.seoDescription,
      robots: fields.robots,
      inSitemap: fields.inSitemap,
      legacyLastmod: toDate(fields.legacyLastmod),
      // the spec: this one path is live-301ed to /brand/smeg/, so its category row is archived.
      status: c.path === CATEGORY_PATH_REDIRECTED_TO_BRAND ? "archived" : "active",
      sort: c.productCount,
    };
  });
  const set = excludedSet(categoriesTable, [
    "parentId",
    "slug",
    "path",
    "name",
    "descriptionHtml",
    "seoTitle",
    "seoDescription",
    "robots",
    "inSitemap",
    "legacyLastmod",
    "status",
    "sort",
  ]);

  if (!ctx.dry) {
    // Parents before children: `readLegacyCategories` returns them topologically and the chunking
    // preserves that order, so the self-FK is always satisfiable.
    await inChunks(rows, CHUNK, async (chunk) => {
      await ctx.db.transaction(async (tx) => {
        await tx.insert(categoriesTable).values(chunk as never).onConflictDoUpdate({ target: categoriesTable.id, set });
      });
    });
    await syncSequence(ctx, "categories");
  }
  ctx.report.categories = categories.length;
  return categories;
}

// ── attributes ─────────────────────────────────────────────────────────────────────────────────

async function importAttributes(ctx: SeedContext): Promise<number | null> {
  const terms = await readColorTerms(ctx.extractDir);
  ctx.log.info({ colorTerms: terms.length }, "colour vocabulary read");
  if (ctx.dry) return null;
  await ctx.db.transaction(async (tx) => {
    await tx
      .insert(attributesTable)
      .values({
        key: COLOR_ATTRIBUTE.key,
        label: COLOR_ATTRIBUTE.label,
        unit: COLOR_ATTRIBUTE.unit,
        kind: COLOR_ATTRIBUTE.kind,
        isFilterable: COLOR_ATTRIBUTE.isFilterable,
        isComparable: COLOR_ATTRIBUTE.isComparable,
        sort: COLOR_ATTRIBUTE.sort,
      })
      .onConflictDoUpdate({
        target: attributesTable.key,
        set: excludedSet(attributesTable, ["label", "unit", "kind", "isFilterable", "isComparable", "sort"]),
      });
  });
  const row = await ctx.db
    .select({ id: attributesTable.id })
    .from(attributesTable)
    .where(eq(attributesTable.key, COLOR_ATTRIBUTE.key))
    .limit(1);
  return row[0]?.id ?? null;
}

// ── products ───────────────────────────────────────────────────────────────────────────────────

type PreparedProduct = {
  legacy: LegacyProduct;
  row: Record<string, unknown>;
  specs: SpecRow[];
  categoryIds: number[];
  colorName: string | null;
  brandSlug: string | null;
  key: string;
  buyable: boolean;
  hasImage: boolean;
  price: number;
};

function curatedType(p: LegacyProduct): string | null {
  const sub = p.curated?.subFa?.trim() || null;
  if (!sub || CURATED_NEEDS_REVIEW.includes(sub)) return null;
  return sub;
}

function prepare(
  ctx: SeedContext,
  p: LegacyProduct,
  brands: Map<string, BrandRow>,
  categoryIndex: CategoryIndex,
  seo: SeoMaps,
): PreparedProduct {
  const brand = p.brand.slug ? (brands.get(p.brand.slug) ?? null) : null;
  const modelCode = extractModelCode(p.name, p.sku);
  const colorRaw = p.colorNames[0] ?? colorFromName(p.name);
  const colorName = colorRaw ? canonicalColorName(colorRaw) || null : null;
  const display = buildDisplayName({
    name: p.name,
    brandFa: brand?.nameFa ?? p.brand.nameFa,
    typeFa: curatedType(p),
    modelCode,
    colorName,
  });
  const { rows: specs, fusedSplit } = specsFromAttributes(p.specAttrs);
  ctx.report.fusedSpecsSplit += fusedSplit;

  const fallbackDims = dimsFromSpecs(specs);
  const dims = p.dimsMm ?? { length: null, width: null, height: null };
  const fields = seoFieldsFor(productPath(p.slug), seo.live, seo.sitemap);
  const compareAt = p.onSale && p.salePrice > 0 && p.regularPrice > p.salePrice ? p.regularPrice : null;
  const hasImage = p.images.some((i) => i.exists);

  const categoryIds = categoryIndex.resolve(p, brand);

  if (display.draft || nameLooksLikeScrape(p.name)) ctx.report.displayNameDrafts += 1;

  return {
    legacy: p,
    specs,
    categoryIds,
    colorName,
    brandSlug: brand?.slug ?? null,
    key: modelKey(p.name, p.sku),
    buyable: p.price > 0 && p.inStock,
    hasImage,
    price: p.price,
    row: {
      id: p.id,
      slug: p.slug,
      name: faZwnj(p.name),
      displayName: display.displayName,
      brandId: brand?.id ?? null,
      sku: p.sku,
      modelCode,
      colorName,
      status: "active",
      visibility: "public",
      // Price 0 stays 0 - `is_on_request` is generated from it (rules: never invent a price).
      price: p.price,
      compareAtPrice: compareAt,
      // Derived, never pinned: a seeded row must follow the panel's rule from then on.
      instalmentPrice: deriveInstalmentPrice(p.price, DEFAULT_INSTALMENTS_RULE),
      instalmentPriceManual: false,
      stockPolicy: "track",
      // Opening stock is written by the `seed` inventory movement below (the trigger applies it).
      stockQty: 0,
      shortHtml: p.shortHtml.trim() ? p.shortHtml : null,
      descriptionHtml: p.descriptionHtml.trim() ? p.descriptionHtml : null,
      weightG: p.weightG ?? fallbackDims.weightG,
      lengthMm: dims.length ?? fallbackDims.lengthMm,
      widthMm: dims.width ?? fallbackDims.widthMm,
      heightMm: dims.height ?? fallbackDims.heightMm,
      seoTitle: fields.seoTitle,
      seoDescription: fields.seoDescription,
      robots: fields.robots,
      legacyLastmod: toDate(fields.legacyLastmod),
      ratingAvg: String(p.ratingAvg),
      ratingCount: p.reviewCount,
      publishedAt: toDate(p.publishedAt),
    },
  };
}

type CategoryIndex = {
  known: Set<number>;
  resolve: (p: LegacyProduct, brand: BrandRow | null) => number[];
};

function buildCategoryIndex(ctx: SeedContext, categories: LegacyCategory[]): CategoryIndex {
  const known = new Set(categories.map((c) => c.id));
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const active = new Map<string, number>();
  const archived = new Map<string, number>();
  for (const c of categories) {
    const key = faNorm(c.name);
    const target = c.path === CATEGORY_PATH_REDIRECTED_TO_BRAND ? archived : active;
    if (!target.has(key)) target.set(key, c.id);
  }
  const brandFallback = (brand: BrandRow | null): number | null => {
    if (!brand) return null;
    for (const label of [brand.nameFa, brand.slug]) {
      if (!label) continue;
      const key = faNorm(`محصولات ${label}`);
      const hit = active.get(key) ?? archived.get(key);
      if (hit !== undefined) return hit;
    }
    return null;
  };
  return {
    known,
    resolve(p, brand) {
      const ids = p.categoryIds.filter((id) => known.has(id));
      // DECISION (M8 browser check): the WP REST `product_cat` fallback is only half-trustworthy - all 29
      // products that are empty in the Store API sit in the same WP bucket (138 «قهوه فرانسه اسمگ»):
      // right for the eight Smeg DCF02 presses, wrong for the Dyson stylers, Tefal choppers, Sage and
      // Ninja machines the sabotaged site dumped there. The WP term is kept only when it names the
      // product's own brand; otherwise a branded product goes to its brand archive and an unbranded
      // one keeps the term (better than nothing).
      if (ids.length > 0 && p.categorySource === "wp" && brand) {
        const brandKey = faNorm(brand.nameFa ?? "");
        const agrees = ids.some((id) => brandKey !== "" && faNorm(nameById.get(id) ?? "").includes(brandKey));
        if (!agrees) {
          const archive = brandFallback(brand);
          if (archive !== null) return [archive];
        }
      }
      if (ids.length > 0) return ids;
      const fallback = brandFallback(brand);
      if (fallback !== null) return [fallback];
      // No category and no brand archive to fall back on: the product is reported, never dropped.
      // DECISION: no "UNSORTED" collection row is invented - extract/collections.ts deliberately
      // reports unsorted ids instead of creating one (its contract), so the report is the record.
      ctx.report.uncategorised += 1;
      return [];
    },
  };
}

async function writeProducts(ctx: SeedContext, prepared: PreparedProduct[]): Promise<void> {
  const set = excludedSet(productsTable, [
    "slug",
    "name",
    "displayName",
    "brandId",
    "sku",
    "modelCode",
    "colorName",
    "status",
    "visibility",
    "price",
    "compareAtPrice",
    "shortHtml",
    "descriptionHtml",
    "weightG",
    "lengthMm",
    "widthMm",
    "heightMm",
    "seoTitle",
    "seoDescription",
    "robots",
    "legacyLastmod",
    "ratingAvg",
    "ratingCount",
    "publishedAt",
  ]);
  // `stock_qty` is deliberately NOT in the set: it belongs to the inventory ledger, and a re-seed
  // must never undo a movement.
  // `instalment_price` travels with `price` (a re-seed that moves one must move the other, or the
  // instalment site would list yesterday's arithmetic) EXCEPT on a row a human pinned - the same
  // rule updatePrice applies, expressed the same way, in SQL against the flag as stored.
  set.instalmentPrice = sql`case when ${productsTable.instalmentPriceManual} then ${productsTable.instalmentPrice} else excluded."instalment_price" end`;
  await inChunks(
    prepared.map((p) => p.row),
    CHUNK,
    async (chunk) => {
      await ctx.db.transaction(async (tx) => {
        await tx.insert(productsTable).values(chunk as never).onConflictDoUpdate({ target: productsTable.id, set });
      });
    },
  );
  await syncSequence(ctx, "products");
}

async function writeProductCategories(ctx: SeedContext, prepared: PreparedProduct[]): Promise<void> {
  const rows: { productId: number; categoryId: number; isPrimary: boolean }[] = [];
  for (const p of prepared) {
    p.categoryIds.forEach((categoryId, i) => {
      rows.push({ productId: p.legacy.id, categoryId, isPrimary: i === 0 });
    });
  }
  await inChunks(rows, CHUNK, async (chunk) => {
    await ctx.db.transaction(async (tx) => {
      await tx
        .insert(productCategoriesTable)
        .values(chunk)
        .onConflictDoUpdate({
          target: [productCategoriesTable.productId, productCategoriesTable.categoryId],
          set: { isPrimary: sql`excluded.is_primary` },
        });
    });
  });
}

/** product_specs has no natural key: replace per product, but only when the rows actually differ. */
async function writeProductSpecs(ctx: SeedContext, prepared: PreparedProduct[]): Promise<void> {
  const ids = prepared.map((p) => p.legacy.id);
  const existing = new Map<number, string>();
  await inChunks(ids, 500, async (chunk) => {
    const rows = await ctx.db
      .select({
        productId: productSpecsTable.productId,
        groupName: productSpecsTable.groupName,
        label: productSpecsTable.label,
        value: productSpecsTable.value,
        sort: productSpecsTable.sort,
      })
      .from(productSpecsTable)
      .where(inArray(productSpecsTable.productId, chunk));
    const grouped = new Map<number, { groupName: string | null; label: string; value: string; sort: number }[]>();
    for (const r of rows) {
      const list = grouped.get(r.productId) ?? [];
      list.push({ groupName: r.groupName, label: r.label, value: r.value, sort: r.sort });
      grouped.set(r.productId, list);
    }
    for (const [productId, list] of grouped) {
      list.sort((a, b) => a.sort - b.sort);
      existing.set(productId, JSON.stringify(list));
    }
  });

  const changed = prepared.filter((p) => {
    const desired = JSON.stringify(
      p.specs.map((s) => ({ groupName: s.groupName, label: s.label, value: s.value, sort: s.sort })),
    );
    const current = existing.get(p.legacy.id) ?? "[]";
    return desired !== current;
  });

  for (const p of changed) {
    await ctx.db.transaction(async (tx) => {
      // Scoped by product_id, inside the same transaction as the re-insert (idempotency rules).
      await tx.delete(productSpecsTable).where(eq(productSpecsTable.productId, p.legacy.id));
      if (p.specs.length === 0) return;
      await tx.insert(productSpecsTable).values(
        p.specs.map((s) => ({
          productId: p.legacy.id,
          groupName: s.groupName,
          label: s.label,
          value: s.value,
          sort: s.sort,
        })),
      );
    });
  }
}

async function writeColorValues(
  ctx: SeedContext,
  prepared: PreparedProduct[],
  attributeId: number | null,
): Promise<void> {
  if (attributeId === null) return;
  const rows = prepared
    .filter((p) => p.colorName)
    .map((p) => ({
      productId: p.legacy.id,
      attributeId,
      valueText: p.colorName as string,
      valueNum: null,
    }));
  await inChunks(rows, CHUNK, async (chunk) => {
    await ctx.db.transaction(async (tx) => {
      await tx
        .insert(productAttributeValuesTable)
        .values(chunk)
        .onConflictDoUpdate({
          target: [productAttributeValuesTable.productId, productAttributeValuesTable.attributeId],
          set: { valueText: sql`excluded.value_text` },
        });
    });
  });
}

/** Append-only: one opening movement and one price row per product, and only when absent. */
async function writeLedgers(ctx: SeedContext, prepared: PreparedProduct[]): Promise<void> {
  const ids = prepared.map((p) => p.legacy.id);
  const seededStock = new Set<number>();
  const seededPrice = new Set<number>();
  await inChunks(ids, 500, async (chunk) => {
    const movements = await ctx.db
      .select({ productId: inventoryMovementsTable.productId })
      .from(inventoryMovementsTable)
      .where(and(inArray(inventoryMovementsTable.productId, chunk), eq(inventoryMovementsTable.reason, "seed")));
    for (const m of movements) seededStock.add(m.productId);
    const prices = await ctx.db
      .select({ productId: priceHistoryTable.productId })
      .from(priceHistoryTable)
      .where(and(inArray(priceHistoryTable.productId, chunk), eq(priceHistoryTable.note, "seed")));
    for (const p of prices) seededPrice.add(p.productId);
  });

  const movements = prepared
    .filter((p) => !seededStock.has(p.legacy.id))
    .map((p) => ({
      productId: p.legacy.id,
      delta: p.legacy.lowStockRemaining ?? (p.legacy.inStock ? STOCK_QTY_WHEN_UNKNOWN : 0),
      reason: "seed" as const,
      actorType: "system" as const,
      actorId: null,
      note: "legacy import opening balance",
    }))
    // CHECK inventory_movements_delta_nonzero: an out-of-stock product simply has no movement.
    .filter((m) => m.delta !== 0);
  await inChunks(movements, CHUNK, async (chunk) => {
    await ctx.db.transaction(async (tx) => {
      await tx.insert(inventoryMovementsTable).values(chunk);
    });
  });

  const prices = prepared
    .filter((p) => !seededPrice.has(p.legacy.id))
    .map((p) => ({
      productId: p.legacy.id,
      price: p.price,
      compareAtPrice: (p.row["compareAtPrice"] as number | null) ?? null,
      actorType: "system" as const,
      actorId: null,
      note: "seed",
    }));
  await inChunks(prices, CHUNK, async (chunk) => {
    await ctx.db.transaction(async (tx) => {
      await tx.insert(priceHistoryTable).values(chunk);
    });
  });
}

// ── product models (variant groups) ─────────────────────────────────────────────────────────────

async function importModels(ctx: SeedContext, prepared: PreparedProduct[]): Promise<void> {
  const groups = groupByModelKey(
    prepared.map((p) => ({
      id: p.legacy.id,
      key: p.key,
      brandSlug: p.brandSlug,
      buyable: p.buyable,
      hasImage: p.hasImage,
      price: p.price,
    })),
  );
  ctx.report.models = groups.length;
  ctx.report.modelMembers = groups.reduce((n, g) => n + g.ids.length, 0);
  if (ctx.dry || groups.length === 0) return;

  const byId = new Map(prepared.map((p) => [p.legacy.id, p]));
  const brandIds = new Map<string, number>();
  for (const b of await ctx.db.select({ id: brandsTable.id, slug: brandsTable.slug }).from(brandsTable)) {
    brandIds.set(b.slug, b.id);
  }

  const rows = groups.map((g) => ({
    key: g.key,
    displayName: (byId.get(g.primaryId)?.row["displayName"] as string | undefined) ?? g.key,
    brandId: g.brandSlug ? (brandIds.get(g.brandSlug) ?? null) : null,
    primaryProductId: g.primaryId,
  }));
  await inChunks(rows, CHUNK, async (chunk) => {
    await ctx.db.transaction(async (tx) => {
      await tx
        .insert(productModelsTable)
        .values(chunk)
        .onConflictDoUpdate({
          target: productModelsTable.key,
          set: excludedSet(productModelsTable, ["displayName", "brandId", "primaryProductId"]),
        });
    });
  });

  const modelIdByKey = new Map<string, number>();
  for (const m of await ctx.db.select({ id: productModelsTable.id, key: productModelsTable.key }).from(productModelsTable)) {
    modelIdByKey.set(m.key, m.id);
  }
  for (const g of groups) {
    const modelId = modelIdByKey.get(g.key);
    if (modelId === undefined) continue;
    await ctx.db
      .update(productsTable)
      .set({ modelId })
      .where(and(inArray(productsTable.id, g.ids), sql`${productsTable.modelId} is distinct from ${modelId}`));
  }
}

// ── collections ────────────────────────────────────────────────────────────────────────────────

async function importCollections(ctx: SeedContext, knownProductIds: Set<number>): Promise<void> {
  const { collections, unsorted, warnings } = await readCuratedCollections(ctx.extractDir);
  for (const w of warnings) warn(ctx.report, w);
  ctx.report.collections = collections.length;
  ctx.report.unsorted = unsorted.length;
  ctx.report.collectionProducts = collections.reduce(
    (n, c) => n + c.productIds.filter((id) => knownProductIds.has(id)).length,
    0,
  );
  if (ctx.dry) return;

  // Parents (groups) first so `parent_id` resolves; the reader already emits them in that order.
  const parents = collections.filter((c) => c.parentSlug === null);
  const children = collections.filter((c) => c.parentSlug !== null);
  const set = excludedSet(collectionsTable, ["name", "kind", "parentId", "isNav", "status", "sort"]);

  const idBySlug = new Map<string, number>();
  const writeBatch = async (batch: typeof collections): Promise<void> => {
    if (batch.length === 0) return;
    await ctx.db.transaction(async (tx) => {
      await tx
        .insert(collectionsTable)
        .values(
          batch.map((c) => ({
            slug: c.slug,
            name: c.name,
            kind: c.kind,
            parentId: c.parentSlug ? (idBySlug.get(c.parentSlug) ?? null) : null,
            isNav: c.isNav,
            status: c.status,
            sort: c.sort,
          })),
        )
        .onConflictDoUpdate({ target: collectionsTable.slug, set });
    });
    for (const r of await ctx.db
      .select({ id: collectionsTable.id, slug: collectionsTable.slug })
      .from(collectionsTable)) {
      idBySlug.set(r.slug, r.id);
    }
  };
  await writeBatch(parents);
  await writeBatch(children);

  const memberships: { collectionId: number; productId: number; sort: number }[] = [];
  for (const c of collections) {
    const collectionId = idBySlug.get(c.slug);
    if (collectionId === undefined) continue;
    let sort = 1;
    for (const productId of c.productIds) {
      if (!knownProductIds.has(productId)) continue;
      memberships.push({ collectionId, productId, sort });
      sort += 1;
    }
  }
  await inChunks(memberships, CHUNK, async (chunk) => {
    await ctx.db.transaction(async (tx) => {
      await tx
        .insert(collectionProductsTable)
        .values(chunk)
        .onConflictDoUpdate({
          target: [collectionProductsTable.collectionId, collectionProductsTable.productId],
          set: { sort: sql`excluded.sort` },
        });
    });
  });
}

// ── stage ──────────────────────────────────────────────────────────────────────────────────────

export async function run(ctx: SeedContext): Promise<void> {
  const seo: SeoMaps = { live: await readSeoLive(ctx.extractDir), sitemap: await readSitemap(ctx.extractDir) };

  const brands = await importBrands(ctx, seo);
  const categories = await importCategories(ctx, seo);
  const attributeId = await importAttributes(ctx);

  const { products, warnings } = await readLegacyProducts(ctx.extractDir, { limit: ctx.limit });
  for (const w of warnings) warn(ctx.report, w);

  const categoryIndex = buildCategoryIndex(ctx, categories);
  const prepared = products.map((p) => prepare(ctx, p, brands, categoryIndex, seo));

  ctx.report.products = prepared.length;
  ctx.report.priced = prepared.filter((p) => p.price > 0).length;
  ctx.report.onRequest = prepared.filter((p) => p.price === 0).length;
  ctx.report.onSale = prepared.filter((p) => p.row["compareAtPrice"] !== null).length;
  ctx.report.inStock = prepared.filter((p) => p.legacy.inStock).length;
  ctx.report.purchasable = prepared.filter((p) => p.buyable).length;
  ctx.report.withImages = prepared.filter((p) => p.hasImage).length;
  ctx.report.withoutImages = prepared.length - ctx.report.withImages;
  ctx.report.unbranded = prepared.filter((p) => p.brandSlug === null).length;
  ctx.report.specsRows = prepared.reduce((n, p) => n + p.specs.length, 0);

  const duplicates = new Map<string, number[]>();
  for (const p of prepared) {
    const key = faNorm(p.legacy.name);
    duplicates.set(key, [...(duplicates.get(key) ?? []), p.legacy.id]);
  }
  for (const [, ids] of duplicates) {
    if (ids.length > 1) warn(ctx.report, `duplicate product name across ids ${ids.join(", ")} (Phase-2 301 decision)`);
  }

  if (!ctx.dry) {
    await writeProducts(ctx, prepared);
    await writeProductCategories(ctx, prepared);
    await writeProductSpecs(ctx, prepared);
    await writeColorValues(ctx, prepared, attributeId);
    await writeLedgers(ctx, prepared);
  }
  await importModels(ctx, prepared);
  await importCollections(ctx, new Set(prepared.map((p) => p.legacy.id)));

  const used = new Set<number>();
  for (const p of prepared) for (const id of p.categoryIds) used.add(id);
  ctx.report.categoriesEmpty = categories.filter((c) => !used.has(c.id)).length;

  ctx.log.info(
    {
      brands: ctx.report.brands,
      categories: ctx.report.categories,
      products: ctx.report.products,
      models: ctx.report.models,
      collections: ctx.report.collections,
    },
    "catalog stage done",
  );
}
