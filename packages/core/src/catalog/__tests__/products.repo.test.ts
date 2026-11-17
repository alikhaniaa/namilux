import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  attributes,
  brands,
  categories as categoriesRef,
  collectionProducts,
  collections,
  eq,
  inventoryReservations,
  media,
  metricsDaily,
  orders,
  productAttributeValues,
  productCategories,
  productImages,
  productModels,
  productSpecs,
  products,
  sql,
} from "@namilux/db";
import type { Db, DbTx } from "@namilux/db";
import { createTestDb, createTestDbAs, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import {
  applyMovement,
  counts,
  findAccessoryIds,
  findAdminRow,
  findBySlug,
  findCardSources,
  findRelatedIds,
  findSiblingIds,
  insertPriceHistory,
  listMovements,
  listPriceHistory,
  listPublicIds,
  listSnapppayFeedProducts,
  listSaleIds,
  queryCards,
  queryFacetSources,
  replaceCategories,
  replaceImages,
  replaceRelations,
  replaceSpecs,
  soldQty90d,
  updatePrice,
  upsertRow,
} from "../products.repo";
import type { ProductWriteValues } from "../products.repo";
import { planQuery } from "../list";
import { DEFAULT_INSTALMENTS_RULE } from "../../pricing/instalments";
import { isAppError } from "../../errors";
import type { ErrorCode } from "../../errors";
import type { Actor } from "../../types";

const ACTOR: Actor = { type: "staff", id: "0000000000000000000STAFF01" };

const PREFIX = "repo-test";

/** Fixed ULID-shaped media ids (Crockford base32) so a fixture is readable in a failure dump. */
const MEDIA_A = "0000000000000000000REPOM01";
const MEDIA_B = "0000000000000000000REPOM02";
const MEDIA_Q = "0000000000000000000REPOM03";
const MEDIA_S = "0000000000000000000REPOM04";

const RENDITIONS = { master: "p/repo/master.jpg", webp: { "480": "p/repo/480.webp" }, avif: {} };

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
  categoryRootId: number;
  categoryChildId: number;
  subId: number;
  groupId: number;
  giftId: number;
  colorAttrId: number;
  powerAttrId: number;
  modelId: number;
  /** sale row, imaged, in stock, in sub+group, model M */
  saleId: number;
  /** price 0 (on request), in stock, in group */
  onRequestId: number;
  /** fully reserved → unavailable */
  reservedId: number;
  /** expired reservation still holds stock until release */
  expiredId: number;
  /** archived */
  archivedId: number;
  /** no brand, no collections */
  isolatedId: number;
  /** same model as saleId (variant sibling) */
  siblingId: number;
  /** same brand only */
  brandOnlyId: number;
  /** gift collection member */
  giftProductId: number;
};

async function insertMedia(tx: Db): Promise<void> {
  await tx
    .insert(media)
    .values([
      {
        id: MEDIA_A,
        kind: "image",
        storageKey: "p/repo/a.jpg",
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
        storageKey: "p/repo/b.jpg",
        mime: "image/jpeg",
        bytes: 1,
        width: 1000,
        height: 1000,
        alt: "",
        renditionsJson: RENDITIONS,
        source: "seed",
      },
      {
        id: MEDIA_Q,
        kind: "image",
        storageKey: "p/repo/q.jpg",
        mime: "image/jpeg",
        bytes: 1,
        alt: "",
        renditionsJson: RENDITIONS,
        normalizeJson: { quarantined: true, reason: "edge_saturation" },
        source: "seed",
      },
      {
        id: MEDIA_S,
        kind: "image",
        storageKey: "p/repo/s.jpg",
        mime: "image/jpeg",
        bytes: 1,
        width: 64,
        height: 64,
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
    .values({ slug: `${PREFIX}-brand`, nameFa: "برند آزمایشی", nameEn: "Repo Brand" })
    .returning({ id: brands.id });
  const brandId = brand?.id ?? 0;

  const [root] = await tx
    .insert(categoriesRef)
    .values({ slug: `${PREFIX}-root`, path: `${PREFIX}-root`, name: "ریشه" })
    .returning({ id: categoriesRef.id });
  const categoryRootId = root?.id ?? 0;
  const [child] = await tx
    .insert(categoriesRef)
    .values({
      slug: `${PREFIX}-child`,
      path: `${PREFIX}-root/${PREFIX}-child`,
      name: "زیرشاخه",
      parentId: categoryRootId,
    })
    .returning({ id: categoriesRef.id });
  const categoryChildId = child?.id ?? 0;

  const collectionRows = await tx
    .insert(collections)
    .values([
      { slug: `${PREFIX}-sub`, name: "زیرمجموعه", kind: "sub", status: "active", sort: 2 },
      { slug: `${PREFIX}-group`, name: "گروه", kind: "group", status: "active", sort: 1 },
      { slug: `${PREFIX}-gift`, name: "هدیه", kind: "gift", status: "active", sort: 3 },
    ])
    .returning({ id: collections.id, slug: collections.slug });
  const idOfCollection = (slug: string): number =>
    collectionRows.find((c) => c.slug === slug)?.id ?? 0;
  const subId = idOfCollection(`${PREFIX}-sub`);
  const groupId = idOfCollection(`${PREFIX}-group`);
  const giftId = idOfCollection(`${PREFIX}-gift`);

  const [colorAttr] = await tx
    .insert(attributes)
    .values({ key: "color", label: "رنگ", kind: "color", isFilterable: true, sort: 1 })
    .onConflictDoUpdate({ target: attributes.key, set: { isFilterable: true, kind: "color", sort: 1 } })
    .returning({ id: attributes.id });
  const [powerAttr] = await tx
    .insert(attributes)
    .values({
      key: "repo_power",
      label: "توان",
      unit: "W",
      kind: "number",
      isFilterable: true,
      sort: 2,
    })
    .onConflictDoUpdate({ target: attributes.key, set: { isFilterable: true, sort: 2 } })
    .returning({ id: attributes.id });
  const colorAttrId = colorAttr?.id ?? 0;
  const powerAttrId = powerAttr?.id ?? 0;

  const [model] = await tx
    .insert(productModels)
    .values({ key: `${PREFIX}-model`, displayName: "مدل آزمایشی", brandId })
    .returning({ id: productModels.id });
  const modelId = model?.id ?? 0;

  const published = new Date(Date.now() - 86_400_000);
  const rows = await tx
    .insert(products)
    .values([
      {
        slug: `${PREFIX}-sale`,
        name: "کالای حراج",
        displayName: "کالای حراج",
        brandId,
        modelId,
        colorName: "مشکی",
        colorHex: "#101010",
        swatchMediaId: MEDIA_S,
        status: "active",
        visibility: "public",
        price: 1_000_000,
        compareAtPrice: 2_000_000,
        costPrice: 400_000,
        stockPolicy: "track",
        stockQty: 5,
        publishedAt: published,
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
        publishedAt: published,
      },
      {
        slug: `${PREFIX}-reserved`,
        name: "کالای رزروشده",
        displayName: "کالای رزروشده",
        brandId,
        status: "active",
        visibility: "public",
        price: 2_000_000,
        stockPolicy: "track",
        stockQty: 2,
      },
      {
        slug: `${PREFIX}-expired`,
        name: "کالای رزرو منقضی",
        displayName: "کالای رزرو منقضی",
        brandId,
        status: "active",
        visibility: "public",
        price: 3_000_000,
        stockPolicy: "track",
        stockQty: 1,
      },
      {
        slug: `${PREFIX}-archived`,
        name: "کالای بایگانی",
        displayName: "کالای بایگانی",
        brandId,
        status: "archived",
        visibility: "public",
        price: 4_000_000,
      },
      {
        slug: `${PREFIX}-isolated`,
        name: "کالای تنها",
        displayName: "کالای تنها",
        status: "active",
        visibility: "public",
        price: 5_000_000,
        stockPolicy: "untracked",
      },
      {
        slug: `${PREFIX}-sibling`,
        name: "کالای هم‌مدل",
        displayName: "کالای هم‌مدل",
        brandId,
        modelId,
        colorName: "سفید",
        colorHex: "#f0f0f0",
        status: "active",
        visibility: "public",
        price: 1_500_000,
        stockPolicy: "track",
        stockQty: 4,
      },
      {
        slug: `${PREFIX}-brand-only`,
        name: "کالای هم‌برند",
        displayName: "کالای هم‌برند",
        brandId,
        status: "active",
        visibility: "public",
        price: 6_000_000,
        stockPolicy: "track",
        stockQty: 1,
      },
      {
        slug: `${PREFIX}-gift`,
        name: "کالای هدیه",
        displayName: "کالای هدیه",
        brandId,
        status: "active",
        visibility: "public",
        price: 700_000,
        stockPolicy: "track",
        stockQty: 2,
      },
    ])
    .returning({ id: products.id, slug: products.slug });

  const idOf = (slug: string): number => rows.find((r) => r.slug === slug)?.id ?? 0;
  const f: Fixture = {
    brandId,
    categoryRootId,
    categoryChildId,
    subId,
    groupId,
    giftId,
    colorAttrId,
    powerAttrId,
    modelId,
    saleId: idOf(`${PREFIX}-sale`),
    onRequestId: idOf(`${PREFIX}-on-request`),
    reservedId: idOf(`${PREFIX}-reserved`),
    expiredId: idOf(`${PREFIX}-expired`),
    archivedId: idOf(`${PREFIX}-archived`),
    isolatedId: idOf(`${PREFIX}-isolated`),
    siblingId: idOf(`${PREFIX}-sibling`),
    brandOnlyId: idOf(`${PREFIX}-brand-only`),
    giftProductId: idOf(`${PREFIX}-gift`),
  };

  await tx.insert(productCategories).values([
    { productId: f.saleId, categoryId: f.categoryChildId, isPrimary: true },
    { productId: f.onRequestId, categoryId: f.categoryRootId, isPrimary: true },
  ]);

  await tx.insert(collectionProducts).values([
    { collectionId: subId, productId: f.saleId, sort: 0 },
    { collectionId: groupId, productId: f.saleId, sort: 0 },
    { collectionId: subId, productId: f.reservedId, sort: 1 },
    { collectionId: groupId, productId: f.onRequestId, sort: 1 },
    { collectionId: giftId, productId: f.giftProductId, sort: 0 },
  ]);

  await tx.insert(productImages).values([
    { productId: f.saleId, mediaId: MEDIA_A, role: "primary", sort: 0, alt: "تصویر اصلی" },
    { productId: f.saleId, mediaId: MEDIA_B, role: "gallery", sort: 1, alt: "" },
    // a quarantined row must never reach a card / the gallery
    { productId: f.saleId, mediaId: MEDIA_Q, role: "gallery", sort: 2, alt: "" },
    { productId: f.reservedId, mediaId: MEDIA_A, role: "primary", sort: 0, alt: "" },
  ]);

  await tx.insert(productAttributeValues).values([
    { productId: f.saleId, attributeId: colorAttrId, valueText: " مشکی " },
    { productId: f.siblingId, attributeId: colorAttrId, valueText: "سفید" },
    { productId: f.reservedId, attributeId: colorAttrId, valueText: "مشکی" },
    { productId: f.saleId, attributeId: powerAttrId, valueNum: "1200" },
  ]);

  // reservations need an order row (FK, NOT NULL)
  await tx.insert(orders).values([
    { id: "0000000000000000000REPOO01", code: "NL-AAAA1", phone: "09121234567" },
    { id: "0000000000000000000REPOO02", code: "NL-AAAA2", phone: "09121234567" },
  ]);
  await tx.insert(inventoryReservations).values([
    {
      id: "0000000000000000000REPOR01",
      productId: f.reservedId,
      orderId: "0000000000000000000REPOO01",
      qty: 2,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
    {
      // An elapsed deadline is not a release while a payment may still be in progress.
      id: "0000000000000000000REPOR02",
      productId: f.expiredId,
      orderId: "0000000000000000000REPOO02",
      qty: 1,
      expiresAt: new Date(Date.now() - 3_600_000),
    },
  ]);

  return f;
}

describe.skipIf(!hasTestDb())("catalog/products.repo against Postgres", () => {
  let handle: TestDb;
  /** null when DATABASE_URL_WEB is absent - the role assertions then document, not fail. */
  let web: TestDb | null = null;

  beforeAll(async () => {
    handle = await createTestDb();
    try {
      web = await createTestDbAs("web");
    } catch {
      web = null;
    }
  }, 120_000);

  afterAll(async () => {
    await web?.close();
    await handle.close();
  });

  const run = <T>(fn: (tx: DbTx, f: Fixture) => Promise<T>): Promise<T> =>
    withTestTx(handle.db, async (tx) => fn(tx, await seedFixture(tx)));

  it("crawler feed filters in SQL, keeps stable pages, and resolves a single product", async () => {
    await run(async (tx, f) => {
      await tx.update(products).set({ instalmentEligible: true }).where(eq(products.id, f.saleId));
      const single = await listSnapppayFeedProducts(tx, { page: 1, size: 1, id: f.saleId });
      expect(single).toEqual({ slugs: [`${PREFIX}-sale`], total: 1 });
      expect(await listSnapppayFeedProducts(tx, { page: 1, size: 1, slug: `${PREFIX}-sale` })).toEqual(single);
      for (const id of [f.archivedId, f.onRequestId, f.isolatedId]) {
        expect(await listSnapppayFeedProducts(tx, { page: 1, size: 1, id })).toEqual({ slugs: [], total: 0 });
      }
      const all = await listSnapppayFeedProducts(tx, { page: 1, size: 500 });
      const first = await listSnapppayFeedProducts(tx, { page: 1, size: 2 });
      const second = await listSnapppayFeedProducts(tx, { page: 2, size: 2 });
      expect([...first.slugs, ...second.slugs]).toEqual(all.slugs.slice(0, 4));
      expect(first.total).toBe(all.total);
      expect(second.total).toBe(all.total);
      expect(await listSnapppayFeedProducts(tx, { page: all.total + 1, size: 1 })).toEqual({ slugs: [], total: all.total });
      await tx.update(products).set({ instalmentEligible: false }).where(eq(products.id, f.saleId));
      expect(await listSnapppayFeedProducts(tx, { page: 1, size: 1, id: f.saleId })).toEqual({ slugs: [], total: 0 });
    });
  }, 30_000);

  it("order preserved", async () => {
    await run(async (tx, f) => {
      const order = [f.reservedId, f.saleId, f.onRequestId];
      const sources = await findCardSources(tx, [...order, 987_654_321]);
      expect(sources.map((s) => s.id)).toEqual(order);
      // an archived row is never hydrated (rules)
      expect((await findCardSources(tx, [f.archivedId])).length).toBe(0);
      // no ids → no query, no throw
      expect(await findCardSources(tx, [])).toEqual([]);
    });
  }, 30_000);

  it("expired reservation remains unavailable until explicitly released", async () => {
    await run(async (tx, f) => {
      const [reserved, expired] = await findCardSources(tx, [f.reservedId, f.expiredId]);
      expect(reserved?.reservedQty).toBe(2);
      // stock 2 − reserved 2 → unavailable
      expect((reserved?.stockQty ?? 0) - (reserved?.reservedQty ?? 0)).toBe(0);
      expect(expired?.reservedQty).toBe(1);

      const full = await findBySlug(tx, `${PREFIX}-reserved`);
      expect(full?.reservedQty).toBe(2);

      // the availability predicate agrees: `avail:["in"]` drops the fully reserved row
      const plan = planQuery({ scope: { kind: "brand", id: f.brandId }, avail: ["in"] });
      const { ids } = await queryCards(tx, plan);
      expect(ids).not.toContain(f.reservedId);
      expect(ids).not.toContain(f.expiredId);
      await tx.update(inventoryReservations).set({ releasedAt: new Date() }).where(eq(inventoryReservations.productId, f.expiredId));
      expect((await findCardSources(tx, [f.expiredId]))[0]?.reservedQty).toBe(0);
      expect((await queryCards(tx, plan)).ids).toContain(f.expiredId);
    });
  }, 30_000);

  it("duplicate primary image", async () => {
    await run(async (tx, f) => {
      // The partial unique index makes a second `primary` impossible going forward; the legacy
      // import is not so tidy, so the ordering rule is proven against a legacy-shaped row set.
      await tx.execute(sql`drop index if exists product_images_primary_uq`);
      await tx.delete(productImages).where(eq(productImages.productId, f.saleId));
      await tx.insert(productImages).values([
        { productId: f.saleId, mediaId: MEDIA_A, role: "primary", sort: 5, alt: "دیرتر" },
        { productId: f.saleId, mediaId: MEDIA_B, role: "primary", sort: 1, alt: "زودتر" },
        { productId: f.saleId, mediaId: MEDIA_S, role: "gallery", sort: 3, alt: "گالری" },
      ]);

      const full = await findBySlug(tx, `${PREFIX}-sale`);
      // lowest sort wins the primary slot; the other primary is ordered as a gallery image
      expect(full?.images.map((i) => [i.role, i.sort])).toEqual([
        ["primary", 1],
        ["gallery", 3],
        ["primary", 5],
      ]);
      const [card] = await findCardSources(tx, [f.saleId]);
      expect(card?.images[0]?.alt).toBe("زودتر");
    });
  }, 30_000);

  it("quarantined image is dropped and alt falls back", async () => {
    await run(async (tx, f) => {
      const [card] = await findCardSources(tx, [f.saleId]);
      // three image rows, one quarantined → two usable refs
      expect(card?.images.length).toBe(2);
      expect(card?.images[0]?.alt).toBe("تصویر اصلی");
      // the gallery row has an empty alt and the media row has none → display name
      expect(card?.images[1]?.alt).toBe("کالای حراج");
    });
  }, 30_000);

  it("movement crossing zero", async () => {
    await run(async (tx, f) => {
      // drain the row to 0 first, then cross back up
      const drained = await applyMovement(tx, {
        productId: f.saleId,
        delta: -5,
        reason: "sale",
        actor: ACTOR,
        orderId: null,
        note: null,
      });
      expect(drained.stockQty).toBe(0);
      expect(drained.availableAfter).toBe(0);

      const crossed = await applyMovement(tx, {
        productId: f.saleId,
        delta: 1,
        reason: "restock",
        actor: ACTOR,
        orderId: null,
        note: "بازپرسازی",
      });
      expect(crossed).toEqual({ stockQty: 1, availableBefore: 0, availableAfter: 1 });

      const movements = await listMovements(tx, f.saleId, 10);
      expect(movements.map((m) => m.delta)).toEqual([1, -5]);
      expect(movements[0]?.reason).toBe("restock");
      expect(typeof movements[0]?.createdAt).toBe("string");
    });
  }, 30_000);

  it("negative stock guard", async () => {
    await run(async (tx, f) => {
      await expectAppError(
        applyMovement(tx, {
          productId: f.saleId,
          delta: -6,
          reason: "sale",
          actor: ACTOR,
          orderId: null,
          note: null,
        }),
        "CONFLICT",
      );
      await expectAppError(
        applyMovement(tx, {
          productId: f.saleId,
          delta: 0,
          reason: "adjust",
          actor: ACTOR,
          orderId: null,
          note: null,
        }),
        "VALIDATION",
      );
      await expectAppError(
        applyMovement(tx, {
          productId: 987_654_321,
          delta: 1,
          reason: "seed",
          actor: ACTOR,
          orderId: null,
          note: null,
        }),
        "NOT_FOUND",
      );

      // a correction reason may go below zero
      const corrected = await applyMovement(tx, {
        productId: f.saleId,
        delta: -6,
        reason: "return",
        actor: ACTOR,
        orderId: null,
        note: null,
      });
      expect(corrected.stockQty).toBe(-1);
      expect(corrected.availableAfter).toBe(0);

      // an untracked row is never guarded
      const untracked = await applyMovement(tx, {
        productId: f.isolatedId,
        delta: -3,
        reason: "adjust",
        actor: ACTOR,
        orderId: null,
        note: null,
      });
      expect(untracked.stockQty).toBe(-3);
    });
  }, 30_000);

  it("related scoring", async () => {
    await run(async (tx, f) => {
      // sub(4)+brand(1)+image(0.5) > group(2)+brand(1) > brand(1); the same-model sibling and the
      // isolated row are excluded.
      const related = await findRelatedIds(tx, f.saleId, 10);
      // sub 4 + brand 1 + image 0.5 = 5.5 · group 2 + brand 1 + available 0.25 = 3.25 · brand 1 +
      // available 0.25 = 1.25; the expired but unreleased hold scores 1 without the stock bonus.
      expect(related.slice(0, 2)).toEqual([f.reservedId, f.onRequestId]);
      expect(related.slice(2)).toEqual(
        [...[f.brandOnlyId, f.giftProductId].sort((a, b) => b - a), f.expiredId],
      );
      expect(related).not.toContain(f.siblingId);
      expect(related).not.toContain(f.isolatedId);
      expect(related).not.toContain(f.archivedId);

      // EDGE CASE: an isolated product (no brand, no collections) relates to nothing
      expect(await findRelatedIds(tx, f.isolatedId, 5)).toEqual([]);

      // an explicit relation wins the first slot whatever it scores
      await replaceRelations(tx, f.saleId, [
        { kind: "related", relatedId: f.brandOnlyId, sort: 0 },
        { kind: "accessory", relatedId: f.giftProductId, sort: 0 },
        // self and duplicate rows are dropped rather than raised
        { kind: "related", relatedId: f.saleId, sort: 1 },
        { kind: "related", relatedId: f.brandOnlyId, sort: 2 },
      ]);
      const withExplicit = await findRelatedIds(tx, f.saleId, 3);
      expect(withExplicit[0]).toBe(f.brandOnlyId);
      expect(withExplicit.length).toBe(3);
      expect(new Set(withExplicit).size).toBe(3);
      expect(await findAccessoryIds(tx, f.saleId)).toEqual([f.giftProductId]);
    });
  }, 30_000);

  it("sold join only when needed", async () => {
    await run(async (tx, f) => {
      const day = new Date().toISOString().slice(0, 10);
      await tx.insert(metricsDaily).values([
        { day, metric: "product.sold_qty", dim: `product:${f.brandOnlyId}`, value: "12" },
        { day, metric: "product.sold_qty", dim: `product:${f.onRequestId}`, value: "5" },
      ]);

      const best = planQuery({ scope: { kind: "brand", id: f.brandId }, sort: "bestselling" });
      expect(best.needsSold90d).toBe(true);
      const bestIds = (await queryCards(tx, best)).ids;
      expect(bestIds[0]).toBe(f.brandOnlyId);
      expect(bestIds[1]).toBe(f.onRequestId);

      // the same scope without the join still runs and orders by the recommended plan
      const recommended = planQuery({ scope: { kind: "brand", id: f.brandId } });
      expect(recommended.needsSold90d).toBe(false);
      const recIds = (await queryCards(tx, recommended)).ids;
      expect(recIds).toContain(f.brandOnlyId);
      // tier 1 (in stock, on request) trails every buyable row
      expect(recIds.indexOf(f.onRequestId)).toBeGreaterThan(recIds.indexOf(f.brandOnlyId));

      const sold = await soldQty90d(tx, [f.brandOnlyId, f.onRequestId, f.saleId]);
      expect(sold.get(f.brandOnlyId)).toBe(12);
      expect(sold.get(f.onRequestId)).toBe(5);
      expect(sold.has(f.saleId)).toBe(false);
      // EDGE CASE: no ids → empty map, no query
      expect((await soldQty90d(tx, [])).size).toBe(0);
    });
  }, 30_000);

  it("web query never selects cost_price", async () => {
    // Documented skip: the assertion needs DATABASE_URL_WEB to open an nl_web connection. Under
    // that role `products.cost_price` has no SELECT grant, so a query whose column list included it
    // would fail with 42501 instead of returning null / [].
    if (web === null) return;
    const db: Db = web.db;
    expect(await findBySlug(db, `${PREFIX}-no-such-slug`)).toBeNull();
    expect(await findCardSources(db, [987_654_321])).toEqual([]);
    expect(await queryCards(db, planQuery({ scope: { kind: "all" } }))).toBeDefined();
    expect(await queryFacetSources(db, { kind: "all" })).toBeDefined();
    await expect(
      db.execute(sql`select cost_price from products limit 1`),
    ).rejects.toThrow();
  }, 60_000);

  it("plan terms: scope, price, colour and attribute filters", async () => {
    await run(async (tx, f) => {
      const brandScope = { kind: "brand", id: f.brandId } as const;

      // category scope includes descendants
      const catPlan = planQuery({ scope: { kind: "category", id: f.categoryRootId } });
      expect((await queryCards(tx, catPlan)).ids.sort()).toEqual(
        [f.saleId, f.onRequestId].sort(),
      );

      // price bounds exclude on-request rows
      const pricePlan = planQuery({ scope: brandScope, priceMin: 1, priceMax: 2_000_000 });
      const priceIds = (await queryCards(tx, pricePlan)).ids;
      expect(priceIds).toContain(f.saleId);
      expect(priceIds).not.toContain(f.onRequestId);

      // colour tokens are faNorm'd on both sides (" مشکی " in the DB, "مشکی" in the URL)
      const colorPlan = planQuery({ scope: brandScope, color: ["مشکی"] });
      expect((await queryCards(tx, colorPlan)).ids.sort()).toEqual([f.saleId, f.reservedId].sort());

      // a number attribute matches on String(valueNum)
      const attrPlan = planQuery({ scope: brandScope, attr: { repo_power: ["1200"] } });
      expect((await queryCards(tx, attrPlan)).ids).toEqual([f.saleId]);

      // an unresolved dimension matches nothing (fail closed)
      const emptyBrand = planQuery({ scope: brandScope, brand: ["no-such-brand"] });
      expect((await queryCards(tx, emptyBrand)).ids).toEqual([]);

      // collection + gifts scopes
      expect((await queryCards(tx, planQuery({ scope: { kind: "collection", id: f.subId } }))).ids.sort()).toEqual(
        [f.saleId, f.reservedId].sort(),
      );
      expect((await queryCards(tx, planQuery({ scope: { kind: "gifts" } }))).ids).toContain(f.giftProductId);

      // window total is the whole filtered set, not the page
      const all = await queryCards(tx, planQuery({ scope: brandScope }));
      expect(all.total).toBe(all.ids.length);
      expect(all.ids).not.toContain(f.archivedId);
      expect(all.ids).not.toContain(f.isolatedId);
    });
  }, 30_000);

  it("facet sources for a scope", async () => {
    await run(async (tx, f) => {
      const facets = await queryFacetSources(tx, { kind: "brand", id: f.brandId });

      // 7 active+public rows carry the fixture brand (archived and isolated do not)
      expect(facets.total).toBe(7);
      expect(facets.price).toEqual({ min: 700_000, max: 6_000_000 });
      // on-request stays "in stock" but is not "ready"; the fully reserved row is neither
      expect(facets.avail.in).toBe(5);
      expect(facets.avail.ready).toBe(4);
      expect(facets.avail.sale).toBe(1);

      expect(facets.brands).toEqual([
        { id: f.brandId, slug: `${PREFIX}-brand`, name: "برند آزمایشی", count: 7 },
      ]);

      // group|sub only, ordered by collections.sort
      expect(facets.collections.map((c) => c.slug)).toEqual([`${PREFIX}-group`, `${PREFIX}-sub`]);
      expect(facets.collections.every((c) => c.count === 2)).toBe(true);

      const colors = facets.attributes.filter((a) => a.key === "color");
      expect(colors.map((c) => [c.value, c.count])).toEqual([
        ["مشکی", 2],
        ["سفید", 1],
      ]);
      // the label keeps the shopper-facing spelling, the value is the faNorm'd URL token
      expect(colors[0]?.valueLabel).toBe("مشکی");
      expect(colors[0]?.hex).toBe("#101010");
      expect(colors[0]?.swatch?.key).toBe("p/repo/s.jpg");

      const power = facets.attributes.filter((a) => a.key === "repo_power");
      expect(power.map((p) => [p.value, p.unit, p.kind, p.count])).toEqual([["1200", "W", "number", 1]]);

      // EDGE CASE: the ids scope never queries and never shows filters
      const none = await queryFacetSources(tx, { kind: "ids", ids: [f.saleId, f.saleId, f.onRequestId] });
      expect(none.total).toBe(2);
      expect(none.brands).toEqual([]);
      expect(none.attributes).toEqual([]);
    });
  }, 30_000);

  it("findBySlug maps the whole aggregate", async () => {
    await run(async (tx, f) => {
      const full = await findBySlug(tx, `${PREFIX}-sale`);
      expect(full).not.toBeNull();
      expect(full?.row.id).toBe(f.saleId);
      expect(full?.row.slug).toBe(`${PREFIX}-sale`);
      // cost_price is not part of ProductRow at all
      expect(Object.keys(full?.row ?? {})).not.toContain("costPrice");
      expect(full?.brand).toEqual({ slug: `${PREFIX}-brand`, name: "برند آزمایشی", nameEn: "Repo Brand" });
      expect(full?.row.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
      expect(full?.categories.map((c) => c.path)).toEqual([`${PREFIX}-root/${PREFIX}-child`]);
      expect(full?.categories[0]?.isPrimary).toBe(true);
      expect(full?.collections.map((c) => c.slug)).toEqual([`${PREFIX}-group`, `${PREFIX}-sub`]);
      expect(full?.collections.every((c) => c.live)).toBe(true);
      expect(full?.attributes.find((a) => a.key === "repo_power")?.valueNum).toBe(1200);
      expect(full?.siblingIds).toEqual([f.siblingId]);
      expect(full?.swatch?.storageKey).toBe("p/repo/s.jpg");

      // archived is invisible unless asked for
      expect(await findBySlug(tx, `${PREFIX}-archived`)).toBeNull();
      expect((await findBySlug(tx, `${PREFIX}-archived`, { includeArchived: true }))?.row.id).toBe(
        f.archivedId,
      );
      expect(await findBySlug(tx, `${PREFIX}-nope`)).toBeNull();

      // specs come back grouped-ready, in sort order
      await replaceSpecs(tx, f.saleId, [
        { groupName: "ابعاد", label: "عرض", value: "۳۰", sort: 1 },
        { groupName: null, label: "وزن", value: "۲", sort: 0 },
      ]);
      const withSpecs = await findBySlug(tx, `${PREFIX}-sale`);
      expect(withSpecs?.specs.map((s) => s.label)).toEqual(["وزن", "عرض"]);
      expect(withSpecs?.specs[1]?.groupName).toBe("ابعاد");
    });
  }, 30_000);

  it("variant siblings hydrate as swatches and exclude self", async () => {
    await run(async (tx, f) => {
      const [card] = await findCardSources(tx, [f.saleId]);
      expect(card?.siblings.map((s) => s.productId)).toEqual([f.siblingId]);
      expect(card?.siblings[0]?.colorName).toBe("سفید");
      expect(card?.siblings[0]?.available).toBe(true);
      expect(card?.siblings[0]?.onRequest).toBe(false);
      expect(await findSiblingIds(tx, f.modelId, f.saleId)).toEqual([f.siblingId]);
      const batch = await findCardSources(tx, [f.saleId, f.siblingId]);
      expect(batch[0]?.siblings).toEqual(card?.siblings);
      expect(batch[1]?.siblings.map((s) => s.productId)).toEqual([f.saleId]);
      await tx.update(products).set({ visibility: "hidden" }).where(eq(products.id, f.siblingId));
      expect((await findCardSources(tx, [f.saleId, f.siblingId]))[0]?.siblings).toEqual([]);
    });
  }, 30_000);

  it("rails and counts use the shared availability predicate", async () => {
    await run(async (tx, f) => {
      const before = await counts(tx);
      expect(before.products).toBeGreaterThanOrEqual(8);

      const publicIds = await listPublicIds(tx);
      expect(publicIds).toContain(f.saleId);
      expect(publicIds).not.toContain(f.archivedId);
      expect([...publicIds]).toEqual([...publicIds].sort((a, b) => a - b));

      const sale = await listSaleIds(tx, 50);
      expect(sale).toContain(f.saleId);
      expect(sale).not.toContain(f.onRequestId);
      expect(await listSaleIds(tx, 0)).toEqual([]);
    });
  }, 30_000);

  it("admin write path: upsert, price history and satellites", async () => {
    await run(async (tx, f) => {
      const admin = await findAdminRow(tx, f.saleId);
      expect(admin?.costPrice).toBe(400_000);
      expect(await findAdminRow(tx, 987_654_321)).toBeNull();

      if (admin === null) throw new Error("fixture product missing");
      const {
        id: _id,
        createdAt: _createdAt,
        updatedAt: _updatedAt,
        ratingAvg: _ratingAvg,
        ratingCount: _ratingCount,
        viewCount: _viewCount,
        stockQty: _stockQty,
        price: _price,
        compareAtPrice: _compareAtPrice,
        priceUpdatedAt: _priceUpdatedAt,
        ...writable
      } = admin;
      const values: ProductWriteValues = {
        ...writable,
        id: f.saleId,
        displayName: "نام تازه",
        seoTitle: "عنوان",
      };
      const { id, before } = await upsertRow(tx, values);
      expect(id).toBe(f.saleId);
      expect(before?.displayName).toBe("کالای حراج");
      const after = await findAdminRow(tx, f.saleId);
      expect(after?.displayName).toBe("نام تازه");
      expect(after?.price).toBe(1_000_000);
      expect(after?.stockQty).toBe(5);

      await updatePrice(tx, f.saleId, 900_000, 2_000_000, DEFAULT_INSTALMENTS_RULE);
      await insertPriceHistory(tx, {
        productId: f.saleId,
        price: 900_000,
        compareAtPrice: 2_000_000,
        actor: ACTOR,
        note: "کاهش قیمت",
      });
      const priced = await findAdminRow(tx, f.saleId);
      expect(priced?.price).toBe(900_000);
      expect(priced?.priceUpdatedAt).not.toBeNull();
      const history = await listPriceHistory(tx, f.saleId, 10);
      expect(history[0]?.price).toBe(900_000);
      expect(history[0]?.actor).toEqual({ type: "staff", id: ACTOR.id });
      expect(await listPriceHistory(tx, f.saleId, 0)).toEqual([]);

      // replace* is idempotent and normalises what the constraints forbid
      await replaceCategories(tx, f.saleId, [
        { categoryId: f.categoryRootId, isPrimary: true },
        { categoryId: f.categoryChildId, isPrimary: true },
        { categoryId: f.categoryRootId, isPrimary: false },
      ]);
      const cats = await tx
        .select({ categoryId: productCategories.categoryId, isPrimary: productCategories.isPrimary })
        .from(productCategories)
        .where(eq(productCategories.productId, f.saleId));
      expect(cats.length).toBe(2);
      expect(cats.filter((c) => c.isPrimary).length).toBe(1);

      await replaceImages(tx, f.saleId, [
        { mediaId: MEDIA_A, role: "primary", sort: 0, alt: "" },
        { mediaId: MEDIA_B, role: "primary", sort: 1, alt: "" },
      ]);
      const imageRoles = await tx
        .select({ role: productImages.role })
        .from(productImages)
        .where(eq(productImages.productId, f.saleId));
      expect(imageRoles.filter((r) => r.role === "primary").length).toBe(1);

      await replaceSpecs(tx, f.saleId, []);
      expect(
        (await tx.select({ id: productSpecs.id }).from(productSpecs).where(eq(productSpecs.productId, f.saleId)))
          .length,
      ).toBe(0);
    });
  }, 30_000);
});
