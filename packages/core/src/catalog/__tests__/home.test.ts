import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  banners,
  brands,
  media,
  notInArray,
  posts,
  productImages,
  products,
} from "@namilux/db";
import type { Db, DbTx } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import {
  HOME_CHAPTER_BRANDS,
  HOME_JOURNAL_SIZE,
  HOME_READY_RAIL_SIZE,
  HOME_SALE_GRID_SIZE,
  getHomeData,
} from "../home";

const PREFIX = "home-test";
const MEDIA_ID = "0000000000000000000HOMEM01";

const RENDITIONS = {
  master: "p/home/master.jpg",
  webp: { "480": "p/home/480.webp" },
  avif: {},
};

type Fixture = {
  brandId: number;
  imagedA: number;
  imagedB: number;
  imagelessC: number;
  outD: number;
  saleE: number;
  saleF: number;
  saleOutG: number;
  productIds: number[];
};

async function seedFixture(tx: Db): Promise<Fixture> {
  await tx
    .insert(media)
    .values({
      id: MEDIA_ID,
      kind: "image",
      storageKey: "p/home/master.jpg",
      mime: "image/jpeg",
      bytes: 1,
      width: 800,
      height: 800,
      alt: "",
      renditionsJson: RENDITIONS,
      source: "admin",
    })
    .onConflictDoNothing();

  const [brand] = await tx
    .insert(brands)
    .values({ slug: `${PREFIX}-brand`, nameFa: "برند خانه", nameEn: "Home Brand" })
    .returning({ id: brands.id });
  const brandId = brand?.id ?? 0;

  const rows = await tx
    .insert(products)
    .values([
      {
        slug: `${PREFIX}-imaged-a`,
        name: "کالای تصویردار الف",
        displayName: "کالای تصویردار الف",
        brandId,
        status: "active" as const,
        visibility: "public" as const,
        price: 5_000_000,
        stockPolicy: "track" as const,
        stockQty: 5,
      },
      {
        slug: `${PREFIX}-imaged-b`,
        name: "کالای تصویردار ب",
        displayName: "کالای تصویردار ب",
        brandId,
        status: "active" as const,
        visibility: "public" as const,
        price: 4_000_000,
        stockPolicy: "track" as const,
        stockQty: 5,
      },
      {
        slug: `${PREFIX}-imageless-c`,
        name: "کالای بی‌تصویر",
        displayName: "کالای بی‌تصویر",
        brandId,
        status: "active" as const,
        visibility: "public" as const,
        price: 3_500_000,
        stockPolicy: "untracked" as const,
      },
      {
        slug: `${PREFIX}-out-d`,
        name: "کالای ناموجود",
        displayName: "کالای ناموجود",
        brandId,
        status: "active" as const,
        visibility: "public" as const,
        price: 3_000_000,
        stockPolicy: "track" as const,
        stockQty: 0,
      },
      {
        slug: `${PREFIX}-sale-e`,
        name: "حراج پنجاه درصد",
        displayName: "حراج پنجاه درصد",
        brandId,
        status: "active" as const,
        visibility: "public" as const,
        price: 1_000_000,
        compareAtPrice: 2_000_000,
        stockPolicy: "track" as const,
        stockQty: 5,
      },
      {
        slug: `${PREFIX}-sale-f`,
        name: "حراج ده درصد",
        displayName: "حراج ده درصد",
        brandId,
        status: "active" as const,
        visibility: "public" as const,
        price: 1_800_000,
        compareAtPrice: 2_000_000,
        stockPolicy: "track" as const,
        stockQty: 5,
      },
      {
        slug: `${PREFIX}-sale-out-g`,
        name: "حراج ناموجود",
        displayName: "حراج ناموجود",
        brandId,
        status: "active" as const,
        visibility: "public" as const,
        price: 1_000_000,
        compareAtPrice: 4_000_000,
        stockPolicy: "track" as const,
        stockQty: 0,
      },
    ])
    .returning({ id: products.id, slug: products.slug });

  const idOf = (suffix: string): number =>
    rows.find((r) => r.slug === `${PREFIX}-${suffix}`)?.id ?? 0;

  const f: Fixture = {
    brandId,
    imagedA: idOf("imaged-a"),
    imagedB: idOf("imaged-b"),
    imagelessC: idOf("imageless-c"),
    outD: idOf("out-d"),
    saleE: idOf("sale-e"),
    saleF: idOf("sale-f"),
    saleOutG: idOf("sale-out-g"),
    productIds: rows.map((r) => r.id),
  };

  await tx.insert(productImages).values([
    { productId: f.imagedA, mediaId: MEDIA_ID, role: "primary" as const, sort: 0, alt: "" },
    { productId: f.imagedB, mediaId: MEDIA_ID, role: "primary" as const, sort: 0, alt: "" },
    { productId: f.saleE, mediaId: MEDIA_ID, role: "primary" as const, sort: 0, alt: "" },
    { productId: f.saleF, mediaId: MEDIA_ID, role: "primary" as const, sort: 0, alt: "" },
    { productId: f.saleOutG, mediaId: MEDIA_ID, role: "primary" as const, sort: 0, alt: "" },
  ]);

  return f;
}

/**
 * The rail and the grid are global aggregates, so the ordering cases narrow the catalogue to the
 * fixture. The UPDATE lives inside `withTestTx` and is rolled back with everything else.
 */
async function isolateCatalogue(tx: Db, keep: number[]): Promise<void> {
  await tx.update(products).set({ status: "draft" }).where(notInArray(products.id, keep));
}

describe.skipIf(!hasTestDb())("catalog/home against Postgres", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await handle.close();
  });

  const run = <T>(fn: (tx: DbTx, f: Fixture) => Promise<T>): Promise<T> =>
    withTestTx(handle.db, async (tx) => fn(tx, await seedFixture(tx)));

  it("hero pick order and empty promo bar", async () => {
    await run(async (tx) => {
      // the slots under test are emptied inside the transaction so the assertion is about MY rows
      await tx.delete(banners);
      const now = new Date();
      const past = new Date(now.getTime() - 3_600_000);
      const older = new Date(now.getTime() - 7_200_000);
      const future = new Date(now.getTime() + 3_600_000);

      const inserted = await tx
        .insert(banners)
        .values([
          { slot: "home_hero" as const, title: "دوم", isActive: true, sort: 2, mediaLightId: MEDIA_ID },
          { slot: "home_hero" as const, title: "اول", isActive: true, sort: 1, mediaLightId: MEDIA_ID },
          { slot: "home_hero" as const, title: "هم‌رتبه", isActive: true, sort: 1, mediaLightId: MEDIA_ID },
          { slot: "home_hero" as const, title: "خاموش", isActive: false, sort: 0 },
          { slot: "home_hero" as const, title: "منقضی", isActive: true, sort: 0, startsAt: older, endsAt: past },
          { slot: "home_hero" as const, title: "آینده", isActive: true, sort: 0, startsAt: future },
        ])
        .returning({ id: banners.id, title: banners.title });

      const data = await getHomeData(tx, now);
      // EDGE CASE: lower sort wins; equal sort → lower id (the two sort-1 rows)
      expect(data.hero?.title).toBe("اول");
      expect(data.hero?.id).toBe(inserted.find((b) => b.title === "اول")?.id);
      // EDGE CASE: promo_bar with none live → []
      expect(data.promoBar).toEqual([]);
      expect(data.generatedAt).toBe(now.toISOString());

      // EDGE CASE: no live home_hero banner → hero null
      await tx.delete(banners);
      const empty = await getHomeData(tx, now);
      expect(empty.hero).toBeNull();
    });
  }, 120_000);

  it("reviewed ready rail and sale grid ordering", async () => {
    await run(async (tx, f) => {
      await isolateCatalogue(tx, f.productIds);
      const data = await getHomeData(tx, new Date());

      const railIds = data.readyRail.map((c) => c.id);
      // only available && priced rows, never the out-of-stock one
      expect(railIds).not.toContain(f.outD);
      expect(railIds).not.toContain(f.saleOutG);
      expect(railIds.length).toBeLessThanOrEqual(HOME_READY_RAIL_SIZE);
      expect(railIds.sort((a, b) => a - b)).toEqual(
        [f.imagedA, f.imagedB, f.saleE, f.saleF].sort((a, b) => a - b),
      );
      expect(data.readyRail.every((c) => c.image !== undefined)).toBe(true);
      expect(railIds).not.toContain(f.imagelessC);

      // EDGE CASE: available first, then discount desc, then id desc - an unavailable sale row fills
      expect(data.saleGrid.map((c) => c.id)).toEqual([f.saleE, f.saleF, f.saleOutG]);
      expect(data.saleGrid.length).toBeLessThanOrEqual(HOME_SALE_GRID_SIZE);
      expect(data.saleGrid[2]?.available).toBe(false);

      // the store block is settings-driven and never empty
      expect(data.store.name).not.toBe("");
      expect(data.store.addressShort.split("،").length).toBeLessThanOrEqual(2);
      expect(data.store.address.startsWith(data.store.addressShort)).toBe(true);
      expect(Array.isArray(data.collections)).toBe(true);
    });
  }, 120_000);

  it("no sale products means an empty grid", async () => {
    await run(async (tx, f) => {
      await isolateCatalogue(tx, [f.imagedA, f.imagelessC]);
      const data = await getHomeData(tx, new Date());
      expect(data.saleGrid).toEqual([]);
      expect(data.readyRail.map((c) => c.id).sort((a, b) => a - b)).toEqual(
        [f.imagedA],
      );
    });
  }, 120_000);

  it("missing chapter brand skipped", async () => {
    await run(async (tx) => {
      await tx.delete(banners);
      await tx
        .insert(brands)
        .values({ slug: "smeg", nameFa: "اسمگ", nameEn: "SMEG", isActive: true })
        .onConflictDoUpdate({ target: brands.slug, set: { isActive: true } });
      // EDGE CASE: dyson inactive → chapters has only smeg
      await tx
        .insert(brands)
        .values({ slug: "dyson", nameFa: "دایسون", nameEn: "Dyson", isActive: false })
        .onConflictDoUpdate({ target: brands.slug, set: { isActive: false } });

      await tx.insert(banners).values([
        {
          slot: "home_band" as const,
          title: "فصل اسمگ",
          isActive: true,
          sort: 0,
          mediaLightId: MEDIA_ID,
          targetingJson: { brandSlug: "smeg" },
        },
        {
          slot: "home_band" as const,
          title: "فصل بی‌هدف",
          isActive: true,
          sort: 1,
          mediaLightId: MEDIA_ID,
        },
      ]);

      const data = await getHomeData(tx, new Date());
      expect(HOME_CHAPTER_BRANDS).toEqual(["smeg", "dyson"]);
      expect(data.chapters.map((c) => c.brand.slug)).toEqual(["smeg"]);
      // only a band that names the brand is used
      expect(data.chapters[0]?.banner?.title).toBe("فصل اسمگ");
    });
  }, 120_000);

  it("journal size", async () => {
    await run(async (tx) => {
      const now = Date.now();
      await tx.insert(posts).values(
        [0, 1, 2, 3].map((i) => ({
          slug: `${PREFIX}-post-${i}`,
          title: `یادداشت ${i}`,
          excerpt: "چکیده",
          bodyHtml: "<p>متن</p>",
          status: "published" as const,
          publishedAt: new Date(now - i * 60_000),
          readMinutes: 2,
        })),
      );

      const data = await getHomeData(tx, new Date());
      expect(data.journal).toHaveLength(HOME_JOURNAL_SIZE);
      expect(data.journal.map((p) => p.slug)).toEqual([
        `${PREFIX}-post-0`,
        `${PREFIX}-post-1`,
        `${PREFIX}-post-2`,
      ]);
    });
  }, 120_000);
});
