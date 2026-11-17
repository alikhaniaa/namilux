import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  brands,
  categories as categoriesRef,
  collectionProducts,
  collections,
  eq,
  jobs as jobsTable,
  media,
  priceHistory,
  productCategories,
  productImages,
  productModels,
  productRelations,
  productSpecs,
  products,
  sql,
} from "@namilux/db";
import type { Db, DbTx } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import {
  RELATED_SIZE,
  getProductAdmin,
  getProductBySlug,
  getProductCards,
  setPrice,
  upsertProduct,
  adjustStock,
} from "../products.service";
import { adjustStock as inventoryAdjustStock } from "../../inventory/stock";
import { isAppError } from "../../errors";
import type { ErrorCode } from "../../errors";
import type { Actor, ProductAdminInput } from "../../types";

const ACTOR: Actor = { type: "staff", id: "0000000000000000000STAFF01" };

const PREFIX = "svc-test";
const ORIGIN = "https://namilux.test";

/** Fixed ULID-shaped media ids (Crockford base32) so a fixture is readable in a failure dump. */
const MEDIA_A = "0000000000000000000SVCM001";
const MEDIA_B = "0000000000000000000SVCM002";

const RENDITIONS = { master: "p/svc/master.jpg", webp: { "480": "p/svc/480.webp" }, avif: {} };

/** The moment every card in these tests is rendered at - nothing here reads the wall clock. */
const NOW = new Date("2026-08-26T09:00:00.000Z");
/** Two days before NOW: inside cards.NEW_DAYS, so «جدید» is deterministic. */
const PUBLISHED = new Date("2026-08-24T09:00:00.000Z");

async function expectAppError(p: Promise<unknown>, code: ErrorCode): Promise<void> {
  let caught: unknown = null;
  try {
    await p;
  } catch (err: unknown) {
    caught = err;
  }
  expect(isAppError(caught) ? caught.code : caught).toBe(code);
}

type Fixture = {
  brandId: number;
  categoryChildId: number;
  liveCollectionId: number;
  expiredCollectionId: number;
  /** the full PDP subject: sale, low stock, two images, specs, variants, relations */
  mainId: number;
  /** same model as mainId */
  variantId: number;
  /** active, public, tracked, qty 200 → available but NOT low stock */
  stockedId: number;
  /** price 0 */
  onRequestId: number;
  /** no images at all, untracked */
  bareId: number;
  hiddenId: number;
  draftId: number;
  archivedId: number;
  linkOnlyId: number;
  /** legacy_lastmod set → its slug is frozen */
  legacyId: number;
  /** price_basis fx → setPrice refuses it */
  fxId: number;
};

async function insertMedia(tx: Db): Promise<void> {
  await tx
    .insert(media)
    .values([
      {
        id: MEDIA_A,
        kind: "image",
        storageKey: "p/svc/a.jpg",
        mime: "image/jpeg",
        bytes: 1,
        width: 1000,
        height: 1000,
        alt: "",
        renditionsJson: RENDITIONS,
        source: "seed",
      },
      {
        id: MEDIA_B,
        kind: "image",
        storageKey: "p/svc/b.jpg",
        mime: "image/jpeg",
        bytes: 1,
        width: 1000,
        height: 1000,
        alt: "",
        renditionsJson: RENDITIONS,
        source: "seed",
      },
    ])
    .onConflictDoNothing();
}

async function seedFixture(tx: Db): Promise<Fixture> {
  await insertMedia(tx);

  const [brand] = await tx
    .insert(brands)
    .values({ slug: `${PREFIX}-brand`, nameFa: "برند آزمایشی", nameEn: "Service Brand" })
    .returning({ id: brands.id });
  const brandId = brand?.id ?? 0;

  const [root] = await tx
    .insert(categoriesRef)
    .values({ slug: `${PREFIX}-root`, path: `${PREFIX}-root`, name: "ریشه" })
    .returning({ id: categoriesRef.id });
  const rootId = root?.id ?? 0;
  const [child] = await tx
    .insert(categoriesRef)
    .values({
      slug: `${PREFIX}-child`,
      path: `${PREFIX}-root/${PREFIX}-child`,
      name: "زیرشاخه",
      parentId: rootId,
    })
    .returning({ id: categoriesRef.id });
  const categoryChildId = child?.id ?? 0;

  const collectionRows = await tx
    .insert(collections)
    .values([
      { slug: `${PREFIX}-live`, name: "مجموعهٔ زنده", kind: "group", status: "active", sort: 1 },
      {
        slug: `${PREFIX}-expired`,
        name: "کمپین تمام‌شده",
        kind: "campaign",
        status: "active",
        sort: 2,
        endsAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    ])
    .returning({ id: collections.id, slug: collections.slug });
  const idOfCollection = (slug: string): number => collectionRows.find((c) => c.slug === slug)?.id ?? 0;
  const liveCollectionId = idOfCollection(`${PREFIX}-live`);
  const expiredCollectionId = idOfCollection(`${PREFIX}-expired`);

  const [model] = await tx
    .insert(productModels)
    .values({ key: `${PREFIX}-model`, displayName: "مدل آزمایشی", brandId })
    .returning({ id: productModels.id });
  const modelId = model?.id ?? 0;

  const rows = await tx
    .insert(products)
    .values([
      {
        slug: `${PREFIX}-main`,
        name: "کتری برقی اسمگ مدل KLF04",
        displayName: "کتری برقی · مشکی",
        brandId,
        modelId,
        sku: "KLF04BL",
        modelCode: "KLF04",
        colorName: "مشکی",
        colorHex: "#101010",
        status: "active",
        visibility: "public",
        price: 41_500_000,
        compareAtPrice: 48_000_000,
        costPrice: 30_000_000,
        stockPolicy: "track",
        stockQty: 2,
        lowStockThreshold: 3,
        maxPerOrder: 4,
        shortHtml: "<p>خلاصه<script>alert(1)</script></p>",
        descriptionHtml: "<p>توضیح کامل</p>",
        warrantyMonths: 24,
        warrantyText: "گارانتی رسمی",
        lengthMm: 300,
        widthMm: 200,
        heightMm: 250,
        weightG: 1800,
        seoDescription: "توضیح سئو",
        ratingAvg: "4.5",
        ratingCount: 7,
        publishedAt: PUBLISHED,
      },
      {
        slug: `${PREFIX}-variant`,
        name: "کتری برقی اسمگ مدل KLF04 سفید",
        displayName: "کتری برقی · سفید",
        brandId,
        modelId,
        colorName: "سفید",
        colorHex: "#f0f0f0",
        status: "active",
        visibility: "public",
        price: 41_500_000,
        stockPolicy: "track",
        stockQty: 5,
        publishedAt: PUBLISHED,
      },
      {
        slug: `${PREFIX}-stocked`,
        name: "کالای پرموجودی",
        displayName: "کالای پرموجودی",
        brandId,
        status: "active",
        visibility: "public",
        price: 12_000_000,
        stockPolicy: "track",
        stockQty: 200,
        lowStockThreshold: 3,
        publishedAt: PUBLISHED,
      },
      {
        slug: `${PREFIX}-on-request`,
        name: "کالای استعلامی",
        displayName: "کالای استعلامی",
        brandId,
        status: "active",
        visibility: "public",
        price: 0,
        stockPolicy: "track",
        stockQty: 3,
        publishedAt: PUBLISHED,
      },
      {
        slug: `${PREFIX}-bare`,
        name: "کالای بی‌تصویر",
        displayName: "کالای بی‌تصویر",
        status: "active",
        visibility: "public",
        price: 3_000_000,
        stockPolicy: "untracked",
        stockQty: 0,
      },
      {
        slug: `${PREFIX}-hidden`,
        name: "کالای پنهان",
        displayName: "کالای پنهان",
        brandId,
        status: "active",
        visibility: "hidden",
        price: 1_000_000,
      },
      {
        slug: `${PREFIX}-draft`,
        name: "کالای پیش‌نویس",
        displayName: "کالای پیش‌نویس",
        brandId,
        status: "draft",
        visibility: "public",
        price: 1_000_000,
      },
      {
        slug: `${PREFIX}-archived`,
        name: "کالای بایگانی",
        displayName: "کالای بایگانی",
        brandId,
        status: "archived",
        visibility: "public",
        price: 1_000_000,
      },
      {
        slug: `${PREFIX}-link-only`,
        name: "کالای فقط با لینک",
        displayName: "کالای فقط با لینک",
        brandId,
        status: "active",
        visibility: "link_only",
        price: 2_000_000,
        stockPolicy: "untracked",
      },
      {
        slug: `${PREFIX}-legacy`,
        name: "کالای قدیمی",
        displayName: "کالای قدیمی",
        brandId,
        status: "active",
        visibility: "public",
        price: 5_000_000,
        legacyLastmod: new Date("2024-05-05T00:00:00.000Z"),
      },
      {
        slug: `${PREFIX}-fx`,
        name: "کالای ارزی",
        displayName: "کالای ارزی",
        brandId,
        status: "active",
        visibility: "public",
        price: 9_000_000,
        priceBasis: "fx",
        basePrice: "120",
        baseCurrency: "EUR",
      },
    ])
    .returning({ id: products.id, slug: products.slug });
  const idOf = (suffix: string): number => rows.find((r) => r.slug === `${PREFIX}-${suffix}`)?.id ?? 0;

  const mainId = idOf("main");
  const stockedId = idOf("stocked");
  const bareId = idOf("bare");

  await tx.insert(productImages).values([
    { productId: mainId, mediaId: MEDIA_A, role: "primary", sort: 0, alt: "نمای اصلی" },
    { productId: mainId, mediaId: MEDIA_B, role: "gallery", sort: 1, alt: "" },
  ]);

  await tx
    .insert(productCategories)
    .values([{ productId: mainId, categoryId: categoryChildId, isPrimary: true }]);

  await tx.insert(collectionProducts).values([
    { collectionId: liveCollectionId, productId: mainId, sort: 0 },
    { collectionId: expiredCollectionId, productId: mainId, sort: 0 },
  ]);

  // Sort order 1..4 deliberately interleaves the groups so "first-seen order" is observable.
  await tx.insert(productSpecs).values([
    { productId: mainId, groupName: "برق", label: "توان", value: "۲۰۰۰ وات", sort: 1 },
    { productId: mainId, groupName: "ابعاد", label: "عرض", value: "۲۰ سانتی‌متر", sort: 2 },
    { productId: mainId, groupName: null, label: "کد مدل", value: "KLF04", sort: 3 },
    { productId: mainId, groupName: "  ", label: "ولتاژ", value: "۲۲۰ ولت", sort: 4 },
    { productId: mainId, groupName: "برق", label: "فرکانس", value: "۵۰ هرتز", sort: 5 },
  ]);

  await tx.insert(productRelations).values([
    { productId: mainId, relatedId: stockedId, kind: "related", sort: 0 },
    { productId: mainId, relatedId: bareId, kind: "accessory", sort: 0 },
  ]);

  return {
    brandId,
    categoryChildId,
    liveCollectionId,
    expiredCollectionId,
    mainId,
    variantId: idOf("variant"),
    stockedId,
    onRequestId: idOf("on-request"),
    bareId,
    hiddenId: idOf("hidden"),
    draftId: idOf("draft"),
    archivedId: idOf("archived"),
    linkOnlyId: idOf("link-only"),
    legacyId: idOf("legacy"),
    fxId: idOf("fx"),
  };
}

/** The smallest body productAdminSchema accepts; every other field has a default. */
const adminInput = (over: Partial<ProductAdminInput> & { slug: string }): ProductAdminInput =>
  ({
    name: "کالای آزمایشی",
    displayName: "کالای آزمایشی",
    status: "active",
    visibility: "public",
    price: 1_000_000,
    ...over,
  }) as ProductAdminInput;

describe.skipIf(!hasTestDb())("catalog/products.service against Postgres", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await handle.close();
  });

  const run = <T>(fn: (tx: DbTx, f: Fixture) => Promise<T>): Promise<T> =>
    withTestTx(handle.db, async (tx) => fn(tx, await seedFixture(tx)));

  it("hidden returns null", async () => {
    await run(async (tx) => {
      // rules: only status active AND visibility ∈ {public, link_only} is a view.
      expect(await getProductBySlug(tx, `${PREFIX}-hidden`, { now: NOW })).toBeNull();
      expect(await getProductBySlug(tx, `${PREFIX}-draft`, { now: NOW })).toBeNull();
      // the spec: "archived → null (the router consults redirects)".
      expect(await getProductBySlug(tx, `${PREFIX}-archived`, { now: NOW })).toBeNull();
      expect(await getProductBySlug(tx, `${PREFIX}-does-not-exist`, { now: NOW })).toBeNull();
      expect(await getProductBySlug(tx, "   ", { now: NOW })).toBeNull();
    });
  }, 30_000);

  it("link_only noindex", async () => {
    await run(async (tx) => {
      const detail = await getProductBySlug(tx, `${PREFIX}-link-only`, { now: NOW, origin: ORIGIN });
      expect(detail).not.toBeNull();
      // EDGE CASE: "link_only → view with robots forced to noindex, follow".
      expect(detail?.seo.robots).toBe("noindex, follow");
      expect(detail?.visibility).toBe("link_only");
      // …while a public row keeps the column value (default "index, follow").
      const main = await getProductBySlug(tx, `${PREFIX}-main`, { now: NOW, origin: ORIGIN });
      expect(main?.seo.robots).toBe("index, follow");
      // rules: canonical is the DECODED site path; the page encodes it via productUrl.
      expect(main?.seo.canonical).toBe(`/product/${PREFIX}-main/`);
      // rules: seo.title = seo_title ?? `${displayName} - نامی لوکس`; description verbatim.
      expect(main?.seo.title).toBe("کتری برقی · مشکی - نامی لوکس");
      expect(main?.seo.description).toBe("توضیح سئو");
      // the spec: lastmod = legacy_lastmod ?? updated_at.
      expect(typeof main?.seo.lastmod).toBe("string");
    });
  }, 30_000);

  it("on-request detail", async () => {
    await run(async (tx) => {
      const detail = await getProductBySlug(tx, `${PREFIX}-on-request`, { now: NOW, origin: ORIGIN });
      expect(detail).not.toBeNull();
      if (detail === null) return;
      // EDGE CASE: "on-request product → price 0, jsonld has no Offer, compareAt absent".
      expect(detail.price).toBe(0);
      expect(detail.onRequest).toBe(true);
      expect("compareAt" in detail).toBe(false);
      const node = detail.jsonld as Record<string, unknown>;
      expect(node["@type"]).toBe("Product");
      expect("offers" in node).toBe(false);
      expect(node["@id"]).toBe(`${ORIGIN}/product/${PREFIX}-on-request/#product`);

      // …and the priced product DOES publish one, at the injected origin.
      const main = await getProductBySlug(tx, `${PREFIX}-main`, { now: NOW, origin: ORIGIN });
      const offers = (main?.jsonld as Record<string, unknown>).offers as Record<string, unknown>;
      expect(offers.price).toBe("41500000");
      expect(offers.availability).toBe("https://schema.org/InStock");
      // the spec: AggregateRating only when ratingCount ≥ 3 - the fixture has 7.
      expect((main?.jsonld as Record<string, unknown>).aggregateRating).toEqual({
        "@type": "AggregateRating",
        ratingValue: 4.5,
        reviewCount: 7,
      });
    });
  }, 30_000);

  it("stock qty exposure", async () => {
    await run(async (tx) => {
      const low = await getProductBySlug(tx, `${PREFIX}-main`, { now: NOW });
      const deep = await getProductBySlug(tx, `${PREFIX}-stocked`, { now: NOW });
      expect(low).not.toBeNull();
      expect(deep).not.toBeNull();
      if (low === null || deep === null) return;

      // the spec: the exact quantity NEVER leaves the server - see the module's DECISION note.
      // qty 2 ≤ threshold 3 → «آخرین»; qty 200 → available but not low.
      expect(low.available).toBe(true);
      expect(low.lowStock).toBe(true);
      expect(deep.available).toBe(true);
      expect(deep.lowStock).toBe(false);
      for (const key of ["stock", "stockQty", "reservedQty", "availableQty"]) {
        expect(Object.prototype.hasOwnProperty.call(low, key)).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(deep, key)).toBe(false);
      }
      // The only integers the PDP receives about stock are the ORDER caps, not the inventory.
      expect(low.maxPerOrder).toBe(4);
      expect(low.allowBackorder).toBe(false);
      // the spec: html is re-sanitized at read.
      expect(low.shortHtml).not.toContain("<script");
      expect(low.descriptionHtml).toBe("<p>توضیح کامل</p>");
    });
  }, 30_000);

  it("keeps admin gallery angles when the primary image is a manufacturer photo", async () => {
    await run(async (tx) => {
      await tx.update(media).set({ renditionsJson: { ...RENDITIONS, master: "official/svc/main.jpg" } }).where(eq(media.id, MEDIA_A));
      const main = await getProductBySlug(tx, `${PREFIX}-main`, { now: NOW });
      expect(main?.gallery.map((image) => image.key)).toEqual(["p/svc/a.jpg", "p/svc/b.jpg"]);
      expect(main?.gallery[0]?.alt).toBe("نمای اصلی");
    });
  }, 30_000);

  it("imageless product", async () => {
    await run(async (tx) => {
      const bare = await getProductBySlug(tx, `${PREFIX}-bare`, { now: NOW });
      expect(bare).not.toBeNull();
      if (bare === null) return;
      // EDGE CASE: "0 usable images → images [], image undefined, ogImagePath = site fallback".
      expect(bare.gallery).toEqual([]);
      expect(bare.image).toBeUndefined();
      expect(bare.seo.ogImage).toBeNull();
      expect((bare.jsonld as Record<string, unknown>).image).toBeUndefined();
      // untracked, qty 0 → still available (cards rules)
      expect(bare.available).toBe(true);
      expect(bare.lowStock).toBe(false);
      // no brand row → null, never a sentinel that could mint "/brand//"
      expect(bare.brand).toBeNull();

      // …while the imaged product carries the ordered gallery and the master OG key.
      const main = await getProductBySlug(tx, `${PREFIX}-main`, { now: NOW });
      expect(main?.gallery.map((i) => i.key)).toEqual(["p/svc/a.jpg", "p/svc/b.jpg"]);
      expect(main?.image?.alt).toBe("نمای اصلی");
      expect(main?.images2?.key).toBe("p/svc/b.jpg");
      expect(main?.seo.ogImage).toBe(RENDITIONS.master);
    });
  }, 30_000);

  it("spec grouping", async () => {
    await run(async (tx) => {
      const detail = await getProductBySlug(tx, `${PREFIX}-main`, { now: NOW });
      expect(detail).not.toBeNull();
      if (detail === null) return;
      // EDGE CASE: "mixed null/named groups → null group first, others in first-seen order";
      // a whitespace-only group_name is the null group too. Rows keep the `sort` order.
      expect(detail.specs).toEqual([
        { name: null, rows: [{ label: "کد مدل", value: "KLF04" }, { label: "ولتاژ", value: "۲۲۰ ولت" }] },
        {
          name: "برق",
          rows: [
            { label: "توان", value: "۲۰۰۰ وات" },
            { label: "فرکانس", value: "۵۰ هرتز" },
          ],
        },
        { name: "ابعاد", rows: [{ label: "عرض", value: "۲۰ سانتی‌متر" }] },
      ]);
      // …and the rest of the assembled view
      expect(detail.dims).toEqual({ lengthMm: 300, widthMm: 200, heightMm: 250, weightG: 1800 });
      expect(detail.warrantyMonths).toBe(24);
      expect(detail.warrantyText).toBe("گارانتی رسمی");
      expect(detail.sku).toBe("KLF04BL");
      // categories are crumbs with an ENCODED href (types/common.ts), primary first
      expect(detail.categories).toEqual([
        { name: "زیرشاخه", href: `/category/${PREFIX}-root/${PREFIX}-child/` },
      ]);
      // only LIVE collections become chips - the expired campaign is dropped
      expect(detail.collections).toEqual([
        { slug: `${PREFIX}-live`, name: "مجموعهٔ زنده", kind: "group" },
      ]);
      // rails: related (curated first), accessories, siblings - each hydrated as a card
      expect(detail.related.length).toBeGreaterThanOrEqual(1);
      expect(detail.related.length).toBeLessThanOrEqual(RELATED_SIZE);
      expect(detail.related[0]?.slug).toBe(`${PREFIX}-stocked`);
      expect(detail.accessories.map((c) => c.slug)).toEqual([`${PREFIX}-bare`]);
      expect(detail.siblings.map((c) => c.slug)).toEqual([`${PREFIX}-variant`]);
      // variant swatches include self (cards.variantSwatchesFor)
      expect(detail.variants.map((v) => v.colorName).sort()).toEqual(["سفید", "مشکی"]);
      // a rail card never contains the subject itself
      expect([...detail.related, ...detail.accessories, ...detail.siblings].map((c) => c.id)).not.toContain(
        detail.id,
      );
    });
  }, 30_000);

  it("cards cap", async () => {
    await run(async (tx, f) => {
      // EDGE CASE: "getProductCards([...61 ids]) → first 60" - the 61st is never even queried.
      const filler = Array.from({ length: 60 }, (_, i) => 900_000_000 + i);
      expect(await getProductCards(tx, [...filler, f.mainId])).toEqual([]);
      expect((await getProductCards(tx, [f.mainId, ...filler])).map((c) => c.id)).toEqual([f.mainId]);

      // input order preserved, unknown ids skipped, duplicates collapsed
      const order = [f.stockedId, f.mainId, f.bareId];
      expect((await getProductCards(tx, [...order, 987_654_321, f.mainId])).map((c) => c.id)).toEqual(order);
      // draft / hidden / archived never hydrate, even from a stale wishlist
      expect(await getProductCards(tx, [f.hiddenId, f.draftId, f.archivedId])).toEqual([]);
      // link_only DOES hydrate (a saved wishlist row must keep working)
      expect((await getProductCards(tx, [f.linkOnlyId])).map((c) => c.id)).toEqual([f.linkOnlyId]);
      // junk ids are dropped, never sent to the repository
      expect(await getProductCards(tx, [0, -3, 1.5, Number.NaN])).toEqual([]);
      expect(await getProductCards(tx, [])).toEqual([]);
    });
  }, 30_000);

  it("setPrice validation table", async () => {
    await run(async (tx, f) => {
      // rules: "integer Toman, price ≥ 0, compareAt null or > price (else VALIDATION)".
      await expectAppError(setPrice(tx, f.mainId, -1, null, ACTOR), "VALIDATION");
      await expectAppError(setPrice(tx, f.mainId, 1.5, null, ACTOR), "VALIDATION");
      await expectAppError(setPrice(tx, f.mainId, 10_000, 10_000, ACTOR), "VALIDATION");
      await expectAppError(setPrice(tx, f.mainId, 10_000, 9_000, ACTOR), "VALIDATION");
      // an on-request row carries no "was" price (validation/catalog-admin saleRule)
      await expectAppError(setPrice(tx, f.mainId, 0, 10_000, ACTOR), "VALIDATION");
      // EDGE CASE: "fx row → CONFLICT"
      await expectAppError(setPrice(tx, f.fxId, 10_000_000, null, ACTOR), "CONFLICT");
      // an unknown product is a 404, not a silent no-op
      await expectAppError(setPrice(tx, 987_654_321, 10_000, null, ACTOR), "NOT_FOUND");
      // nothing was written by any of the refusals
      const [row] = await tx
        .select({ price: products.price, n: sql<number>`(select count(*)::int from price_history where product_id = ${f.mainId})` })
        .from(products)
        .where(eq(products.id, f.mainId));
      expect(row?.price).toBe(41_500_000);
      expect(Number(row?.n)).toBe(0);
    });
  }, 30_000);

  it("setPrice no-op", async () => {
    await run(async (tx, f) => {
      // EDGE CASE: "same values → no history row". The identical write returns BEFORE the
      // transaction is opened, which is also why this case passes while ../../audit is unbuilt at the time.
      await expect(setPrice(tx, f.mainId, 41_500_000, 48_000_000, ACTOR)).resolves.toBeUndefined();
      const rows = await tx.select({ id: priceHistory.id }).from(priceHistory).where(eq(priceHistory.productId, f.mainId));
      expect(rows).toEqual([]);
    });
  }, 30_000);

  it("legacy slug immutable", async () => {
    await run(async (tx, f) => {
      // EDGE CASE: "upsert with legacy id and a changed slug → CONFLICT" (the spec: a URL that ever
      // served 200 keeps working; the 752-URL contract check depends on it).
      await expectAppError(
        upsertProduct(tx, adminInput({ id: f.legacyId, slug: `${PREFIX}-legacy-renamed` }), ACTOR),
        "CONFLICT",
      );
      // the row is untouched
      const [row] = await tx.select({ slug: products.slug }).from(products).where(eq(products.id, f.legacyId));
      expect(row?.slug).toBe(`${PREFIX}-legacy`);

      // an unknown id is a 404 and an invalid body a VALIDATION - both before any write
      await expectAppError(
        upsertProduct(tx, adminInput({ id: 987_654_321, slug: `${PREFIX}-ghost` }), ACTOR),
        "NOT_FOUND",
      );
      await expectAppError(
        upsertProduct(tx, adminInput({ slug: `${PREFIX}-bad`, displayName: "ب" }), ACTOR),
        "VALIDATION",
      );
      // price 0 with a compare-at is refused by the schema, not by the DB
      await expectAppError(
        upsertProduct(tx, adminInput({ slug: `${PREFIX}-bad2`, price: 0, compareAtPrice: 10 }), ACTOR),
        "VALIDATION",
      );
    });
  }, 30_000);

  it("a new product on a slug another product has is a CONFLICT on the slug, not INTERNAL", async () => {
    await run(async (tx) => {
      const err = await upsertProduct(tx, adminInput({ slug: `${PREFIX}-main` }), ACTOR).then(
        () => null,
        (e: unknown) => e,
      );
      expect(isAppError(err) && err.code).toBe("CONFLICT");
      expect(isAppError(err) && err.details).toMatchObject({ field: "slug", reason: "slug_taken" });
    });
  }, 30_000);

  it("admin view", async () => {
    await run(async (tx, f) => {
      const view = await getProductAdmin(tx, f.mainId);
      expect(view).not.toBeNull();
      if (view === null) return;
      // the admin row is the only place cost_price is readable
      expect(view.row.costPrice).toBe(30_000_000);
      expect(view.full.row.id).toBe(f.mainId);
      expect(view.full.images.length).toBe(2);
      // stock 2, no reservations → 2 available
      expect(view.availableQty).toBe(2);
      expect(view.siblings.map((c) => c.id)).toEqual([f.variantId]);
      expect(view.priceHistory).toEqual([]);
      expect(view.movements).toEqual([]);
      // an archived row is still editable
      expect((await getProductAdmin(tx, f.archivedId))?.row.status).toBe("archived");
      expect(await getProductAdmin(tx, 987_654_321)).toBeNull();
      expect(await getProductAdmin(tx, 0)).toBeNull();
    });
  }, 30_000);

  /**
   * The owner/admin split: `cost_price` is the head admin's field, so an admin's form never carries
   * the key. An ABSENT key must therefore preserve what is stored - the same rule `publishedAt`
   * follows - or every ordinary product edit by an admin would wipe the margin. `null` is still an
   * explicit clear, which is what the owner's emptied box sends.
   */
  it("an absent costPrice preserves the stored one; null clears it", async () => {
    await run(async (tx, f) => {
      const base = { id: f.mainId, slug: `${PREFIX}-main`, displayName: "کتری برقی · مشکی" };
      expect((await getProductAdmin(tx, f.mainId))?.row.costPrice).toBe(30_000_000);

      // An admin's payload: every other field, no cost key at all.
      await upsertProduct(tx, adminInput(base), ACTOR);
      expect((await getProductAdmin(tx, f.mainId))?.row.costPrice).toBe(30_000_000);

      // The owner changes it, then empties the box.
      await upsertProduct(tx, adminInput({ ...base, costPrice: 25_000_000 }), ACTOR);
      expect((await getProductAdmin(tx, f.mainId))?.row.costPrice).toBe(25_000_000);
      await upsertProduct(tx, adminInput({ ...base, costPrice: null }), ACTOR);
      expect((await getProductAdmin(tx, f.mainId))?.row.costPrice).toBeNull();

      // …and a later admin edit does not resurrect anything either.
      await upsertProduct(tx, adminInput(base), ACTOR);
      expect((await getProductAdmin(tx, f.mainId))?.row.costPrice).toBeNull();
    });
  }, 30_000);

  it("adjustStock is the inventory ledger implementation", () => {
    // The module re-exports ../../inventory/stock.adjustStock verbatim (its own header: "the spec
    // lists adjustStock under catalog; it is implemented here and re-exported by the catalog admin
    // write module"), so the two behaviours below are owned by that module's test file.
    expect(adjustStock).toBe(inventoryAdjustStock);
  });

  it("adjustStock enqueues back-in-stock once", async () => {
    await run(async (tx, f) => {
      // stockedId holds 200: empty it, then restock twice - one stock.back_in_stock job, never two
      await adjustStock(tx, f.stockedId, -200, "adjust", ACTOR);
      await adjustStock(tx, f.stockedId, 3, "restock", ACTOR);
      await adjustStock(tx, f.stockedId, 3, "restock", ACTOR);
      const queued = (await tx.select().from(jobsTable)).filter((j) => j.type === "stock.back_in_stock" && j.payloadJson["productId"] === f.stockedId);
      expect(queued).toHaveLength(1);
    });
  }, 30_000);

  it("adjustStock zero delta", async () => {
    await run(async (tx, f) => {
      await expect(adjustStock(tx, f.stockedId, 0, "adjust", ACTOR)).rejects.toMatchObject({ code: "VALIDATION" });
    });
  }, 30_000);
});
