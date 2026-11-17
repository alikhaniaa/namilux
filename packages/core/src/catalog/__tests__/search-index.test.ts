import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  brands,
  collectionProducts,
  collections,
  media,
  products,
} from "@namilux/db";
import type { Db, DbTx } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import {
  SEARCH_INDEX_MAX_COLLECTIONS,
  SEARCH_INDEX_MAX_ENTRIES,
  SEARCH_INDEX_TARGET_GZ_BYTES,
  buildSearchIndex,
  indexEtag,
  serializeSearchIndex,
  toSearchIndexEntry,
} from "../search-index";
import type { ProductCard } from "../cards";
import type { ImageRef } from "../media";

const IMAGE: ImageRef = {
  key: "p/search/master.jpg",
  alt: "تصویر",
  width: 1000,
  height: 1000,
  renditions: {
    master: "p/search/master.jpg",
    webp: { "480": "p/search/480.webp", "56": "p/search/56.webp" },
    avif: { "480": "p/search/480.avif" },
  },
};

const card = (over: Partial<ProductCard> = {}): ProductCard => ({
  id: 12,
  slug: "کتری-برقی-اسمگ",
  displayName: "کتری برقی ساده اسمگ KLF03",
  brand: { slug: "smeg", name: "اسمگ", nameEn: "SMEG" },
  modelCode: "KLF03",
  price: 41_500_000,
  onRequest: false,
  available: true,
  lowStock: false,
  badges: [],
  image: IMAGE,
  variants: [],
  publishedAt: null,
  salesRank: 0,
  ...over,
});

describe("catalog/search-index (pure)", () => {
  it("entry shape and key order", () => {
    const entry = toSearchIndexEntry(card(), ["coffee-and-drinks"]);
    expect(entry).toEqual({
      id: 12,
      slug: "کتری-برقی-اسمگ",
      dn: "کتری برقی ساده اسمگ KLF03",
      b: "اسمگ",
      m: "KLF03",
      p: 41_500_000,
      s: true,
      // rules: the SMALLEST webp rendition is the overlay thumb
      i: "p/search/56.webp",
      c: ["coffee-and-drinks"],
    });
    const parsed = JSON.parse(serializeSearchIndex([entry])) as Record<string, unknown>[];
    expect(Object.keys(parsed[0] ?? {})).toEqual([
      "id",
      "slug",
      "dn",
      "b",
      "m",
      "p",
      "s",
      "i",
      "c",
    ]);
    // the spec: nothing else is ever exposed
    expect(Object.keys(entry).sort()).toEqual(["b", "c", "dn", "i", "id", "m", "p", "s", "slug"]);
    expect(SEARCH_INDEX_TARGET_GZ_BYTES).toBe(122_880);
    expect(SEARCH_INDEX_MAX_ENTRIES).toBe(3_000);
  });

  it("brandless product", () => {
    const entry = toSearchIndexEntry(card({ brand: null }), []);
    expect(entry.b).toBe("");
    expect(entry.c).toEqual([]);
  });

  it("imageless product", () => {
    const bare = card();
    delete bare.image;
    delete bare.modelCode;
    const entry = toSearchIndexEntry(bare, []);
    expect(entry.i).toBeUndefined();
    expect(entry.m).toBeUndefined();
    expect(serializeSearchIndex([entry])).not.toContain('"i"');
    expect(serializeSearchIndex([entry])).not.toContain('"m"');
  });

  it("image without a webp map falls back", () => {
    const avifOnly = card({
      image: {
        ...IMAGE,
        renditions: { master: "p/search/master.jpg", webp: {}, avif: { "320": "p/a/320.avif" } },
      },
    });
    expect(toSearchIndexEntry(avifOnly, []).i).toBe("p/a/320.avif");
    const masterOnly = card({
      image: { ...IMAGE, renditions: { master: "p/search/master.jpg", webp: {}, avif: {} } },
    });
    expect(toSearchIndexEntry(masterOnly, []).i).toBe("p/search/master.jpg");
  });

  it("on-request in stock flags", () => {
    const entry = toSearchIndexEntry(card({ price: 0, onRequest: true, available: true }), []);
    expect(entry.p).toBe(0);
    expect(entry.s).toBe(true);
    const out = toSearchIndexEntry(card({ available: false }), []);
    expect(out.s).toBe(false);
  });

  it("collection cap", () => {
    const slugs = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const entry = toSearchIndexEntry(card(), slugs);
    expect(entry.c).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(entry.c).toHaveLength(SEARCH_INDEX_MAX_COLLECTIONS);
    // a repeated slug is counted once
    expect(toSearchIndexEntry(card(), ["a", "a", "b"]).c).toEqual(["a", "b"]);
  });

  it("compact serialization", () => {
    const serialized = serializeSearchIndex([
      toSearchIndexEntry(card(), ["coffee"]),
      toSearchIndexEntry(card({ id: 13, brand: null }), []),
    ]);
    expect(serialized.startsWith("[{")).toBe(true);
    // no whitespace outside strings: the only spaces left are inside the Persian values
    const outsideStrings = serialized.replace(/"(?:[^"\\]|\\.)*"/gu, "");
    expect(/\s/u.test(outsideStrings)).toBe(false);
    expect(JSON.parse(serialized)).toHaveLength(2);
    expect(serializeSearchIndex([])).toBe("[]");
  });

  it("stable etag", () => {
    const a = serializeSearchIndex([toSearchIndexEntry(card(), ["coffee"])]);
    const b = serializeSearchIndex([toSearchIndexEntry(card(), ["coffee"])]);
    expect(indexEtag(a)).toBe(indexEtag(b));
    expect(indexEtag(a)).toMatch(/^[0-9a-f]{16}$/u);
    expect(indexEtag(a)).not.toBe(indexEtag(serializeSearchIndex([toSearchIndexEntry(card({ id: 13 }), [])])));
  });
});

const PREFIX = "index-test";
const MEDIA_ID = "0000000000000000000INDEXM1";

type Fixture = {
  publicId: number;
  linkOnlyId: number;
  hiddenId: number;
  archivedId: number;
  liveSlug: string;
  futureSlug: string;
};

async function seedFixture(tx: Db): Promise<Fixture> {
  await tx
    .insert(media)
    .values({
      id: MEDIA_ID,
      kind: "image",
      storageKey: "p/index/master.jpg",
      mime: "image/jpeg",
      bytes: 1,
      width: 800,
      height: 800,
      alt: "",
      renditionsJson: {
        master: "p/index/master.jpg",
        webp: { "480": "p/index/480.webp", "56": "p/index/56.webp" },
        avif: {},
      },
      source: "seed",
    })
    .onConflictDoNothing();

  const [brand] = await tx
    .insert(brands)
    .values({ slug: `${PREFIX}-brand`, nameFa: "برند ایندکس", nameEn: "Index Brand" })
    .returning({ id: brands.id });
  const brandId = brand?.id ?? 0;

  const rows = await tx
    .insert(products)
    .values([
      {
        slug: `${PREFIX}-public`,
        name: "کالای عمومی",
        displayName: "کالای عمومی",
        brandId,
        status: "active" as const,
        visibility: "public" as const,
        price: 1_000_000,
        stockPolicy: "untracked" as const,
      },
      {
        slug: `${PREFIX}-link-only`,
        name: "کالای لینکی",
        displayName: "کالای لینکی",
        brandId,
        status: "active" as const,
        visibility: "link_only" as const,
        price: 1_000_000,
        stockPolicy: "untracked" as const,
      },
      {
        slug: `${PREFIX}-hidden`,
        name: "کالای پنهان",
        displayName: "کالای پنهان",
        brandId,
        status: "active" as const,
        visibility: "hidden" as const,
        price: 1_000_000,
        stockPolicy: "untracked" as const,
      },
      {
        slug: `${PREFIX}-archived`,
        name: "کالای بایگانی",
        displayName: "کالای بایگانی",
        brandId,
        status: "archived" as const,
        visibility: "public" as const,
        price: 1_000_000,
        stockPolicy: "untracked" as const,
      },
    ])
    .returning({ id: products.id, slug: products.slug });
  const idOf = (suffix: string): number =>
    rows.find((r) => r.slug === `${PREFIX}-${suffix}`)?.id ?? 0;

  const soon = new Date(Date.now() + 86_400_000);
  const collectionRows = await tx
    .insert(collections)
    .values([
      { slug: `${PREFIX}-live`, name: "مجموعه زنده", kind: "sub" as const, status: "active" as const, sort: 1 },
      {
        slug: `${PREFIX}-future`,
        name: "مجموعه آینده",
        kind: "sub" as const,
        status: "active" as const,
        sort: 2,
        startsAt: soon,
      },
      // a campaign collection is never indexed (kinds group|sub only)
      {
        slug: `${PREFIX}-campaign`,
        name: "کمپین",
        kind: "campaign" as const,
        status: "active" as const,
        sort: 3,
      },
    ])
    .returning({ id: collections.id, slug: collections.slug });
  const collectionId = (suffix: string): number =>
    collectionRows.find((c) => c.slug === `${PREFIX}-${suffix}`)?.id ?? 0;

  const publicId = idOf("public");
  await tx.insert(collectionProducts).values([
    { collectionId: collectionId("live"), productId: publicId, sort: 0 },
    { collectionId: collectionId("future"), productId: publicId, sort: 0 },
    { collectionId: collectionId("campaign"), productId: publicId, sort: 0 },
  ]);

  return {
    publicId,
    linkOnlyId: idOf("link-only"),
    hiddenId: idOf("hidden"),
    archivedId: idOf("archived"),
    liveSlug: `${PREFIX}-live`,
    futureSlug: `${PREFIX}-future`,
  };
}

describe.skipIf(!hasTestDb())("catalog/search-index against Postgres", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await handle.close();
  });

  const run = <T>(fn: (tx: DbTx, f: Fixture) => Promise<T>): Promise<T> =>
    withTestTx(handle.db, async (tx) => fn(tx, await seedFixture(tx)));

  it("visibility filter and collection liveness", async () => {
    await run(async (tx, f) => {
      const entries = await buildSearchIndex(tx);
      const byId = new Map(entries.map((e) => [e.id, e]));

      // EDGE CASE: link_only / hidden / archived are excluded, public is present
      expect(byId.has(f.publicId)).toBe(true);
      expect(byId.has(f.linkOnlyId)).toBe(false);
      expect(byId.has(f.hiddenId)).toBe(false);
      expect(byId.has(f.archivedId)).toBe(false);

      const entry = byId.get(f.publicId);
      expect(entry?.b).toBe("برند ایندکس");
      // EDGE CASE: a not-yet-live collection is absent; a campaign kind is never indexed
      expect(entry?.c).toEqual([f.liveSlug]);

      // the whole index is serializable and stable
      const serialized = serializeSearchIndex(entries);
      expect(indexEtag(serialized)).toBe(indexEtag(serializeSearchIndex(entries)));
      expect(JSON.parse(serialized)).toHaveLength(entries.length);
    });
  }, 120_000);
});
