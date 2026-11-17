import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  brands,
  categories,
  collections,
  media,
  pages,
  posts,
  productImages,
  products,
  sql,
} from "@namilux/db";
import type { Db, NewRow } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";

import {
  PRODUCTS_PER_CHILD,
  ROBOTS_DISALLOW,
  SITEMAP_CHILDREN,
  buildSitemap,
  lastmodFor,
  renderIndexXml,
  renderSitemapXml,
  robotsTxt,
  sitemapIndex,
} from "../sitemaps";
import type { SitemapEntry, SitemapIndexEntry } from "../../types";
import { isAppError } from "../../errors";

const ORIGIN = "https://namilux.ir";

/**
 * The child names of the live Yoast index, read once from
 * data/extract/01_sitemap/sitemap_urls.json (`_meta.index`). `local-sitemap.xml` is dropped (the
 * store page is not a separate URL in this build) and `collection-sitemap.xml` is the one new child
 * the spec adds.
 */
const LEGACY_CHILDREN = [
  "post-sitemap.xml",
  "page-sitemap.xml",
  "product-sitemap1.xml",
  "product-sitemap2.xml",
  "product-sitemap3.xml",
  "category-sitemap.xml",
  "product_cat-sitemap.xml",
  "pa_brand-sitemap.xml",
];

// ── pure: child names ──────────────────────────────────────────────────────────────────────────

describe("SITEMAP_CHILDREN", () => {
  it("child names equal the legacy names", () => {
    for (const name of LEGACY_CHILDREN) expect(SITEMAP_CHILDREN).toContain(name);
    expect(SITEMAP_CHILDREN).toContain("collection-sitemap.xml");
    expect(SITEMAP_CHILDREN).toHaveLength(LEGACY_CHILDREN.length + 1);
    // Order matters: the index is emitted in this order and Google compares it to what it knows.
    expect(SITEMAP_CHILDREN.slice(0, LEGACY_CHILDREN.length)).toEqual(LEGACY_CHILDREN);
  });

  it("keeps the legacy three-way product split size", () => {
    expect(PRODUCTS_PER_CHILD).toBe(200);
  });
});

// ── pure: lastmodFor ───────────────────────────────────────────────────────────────────────────

const LAUNCH = "2026-09-01T00:00:00.000Z";
const LEGACY_AT = "2025-05-05T10:00:00.000Z";
const SEEDED_AT = "2026-08-25T19:58:17.233Z";
const EDITED_AT = "2026-09-02T12:00:00.000Z";
const PUBLISHED_AT = "2024-03-05T17:40:47.000Z";

describe("lastmodFor", () => {
  it("legacy lastmod is kept until the entity is edited after launch", () => {
    expect(
      lastmodFor({ legacyLastmod: LEGACY_AT, updatedAt: SEEDED_AT, publishedAt: PUBLISHED_AT, launchAt: LAUNCH }),
    ).toBe(LEGACY_AT);
    expect(
      lastmodFor({ legacyLastmod: LEGACY_AT, updatedAt: EDITED_AT, publishedAt: PUBLISHED_AT, launchAt: LAUNCH }),
    ).toBe(EDITED_AT);
  });

  it("an entity edited exactly at the launch instant still counts as untouched", () => {
    expect(
      lastmodFor({ legacyLastmod: LEGACY_AT, updatedAt: LAUNCH, publishedAt: null, launchAt: LAUNCH }),
    ).toBe(LEGACY_AT);
  });

  it("new entities fall back to published_at, then to updated_at", () => {
    expect(
      lastmodFor({ legacyLastmod: null, updatedAt: SEEDED_AT, publishedAt: PUBLISHED_AT, launchAt: LAUNCH }),
    ).toBe(PUBLISHED_AT);
    expect(lastmodFor({ legacyLastmod: null, updatedAt: SEEDED_AT, publishedAt: null, launchAt: LAUNCH })).toBe(
      SEEDED_AT,
    );
  });

  it("never returns Invalid Date and never stamps the build date", () => {
    const out = lastmodFor({
      legacyLastmod: "not a date",
      updatedAt: SEEDED_AT,
      publishedAt: null,
      launchAt: LAUNCH,
    });
    expect(out).toBe(SEEDED_AT);
    expect(out).not.toContain("Invalid");
    expect(Number.isNaN(Date.parse(out))).toBe(false);
    // ISO 8601 with a timezone (the spec edge cases).
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("normalises any parsable input to a UTC ISO instant", () => {
    expect(
      lastmodFor({
        legacyLastmod: "2026-07-01T20:49:02+00:00",
        updatedAt: SEEDED_AT,
        publishedAt: null,
        launchAt: LAUNCH,
      }),
    ).toBe("2026-07-01T20:49:02.000Z");
  });

  it("throws VALIDATION when no candidate parses at all", () => {
    try {
      lastmodFor({ legacyLastmod: "x", updatedAt: "y", publishedAt: "z", launchAt: "w" });
    } catch (err: unknown) {
      expect(isAppError(err)).toBe(true);
      if (isAppError(err)) expect(err.code).toBe("VALIDATION");
      return;
    }
    throw new Error("expected an AppError VALIDATION");
  });
});

// ── pure: robots.txt ───────────────────────────────────────────────────────────────────────────

describe("robotsTxt", () => {
  it("robots differs for storefront and admin host", () => {
    expect(robotsTxt({ origin: ORIGIN, isAdminHost: true })).toBe("User-agent: *\nDisallow: /");

    const storefront = robotsTxt({ origin: ORIGIN, isAdminHost: false });
    expect(storefront).toBe(
      [
        "User-agent: *",
        "Disallow: /cart/",
        "Disallow: /billing/",
        "Disallow: /compare/",
        "Disallow: /wishlist/",
        "Disallow: /track/",
        "Disallow: /account/",
        "Disallow: /api/",
        "Disallow: /search/",
        "Disallow: /ig/",
        "",
        "Sitemap: https://namilux.ir/sitemap_index.xml",
      ].join("\n"),
    );
    expect(storefront).not.toContain("Disallow: /\n");
  });

  it("ROBOTS_DISALLOW is the nine paths of the spec", () => {
    expect([...ROBOTS_DISALLOW]).toEqual([
      "/cart/",
      "/billing/",
      "/compare/",
      "/wishlist/",
      "/track/",
      "/account/",
      "/api/",
      "/search/",
      "/ig/",
    ]);
  });

  it("tolerates an origin with a trailing slash", () => {
    expect(robotsTxt({ origin: "https://namilux.ir/", isAdminHost: false })).toContain(
      "Sitemap: https://namilux.ir/sitemap_index.xml",
    );
  });
});

// ── pure: rendering ────────────────────────────────────────────────────────────────────────────

describe("renderSitemapXml", () => {
  it("xml escapes & and quotes", () => {
    const xml = renderSitemapXml([
      { loc: "https://namilux.ir/product/a&b/", lastmod: LEGACY_AT },
      { loc: "https://namilux.ir/product/\"q\"<x>'/", lastmod: null },
    ]);
    expect(xml).toContain("<loc>https://namilux.ir/product/a&amp;b/</loc>");
    expect(xml).toContain("&quot;q&quot;&lt;x&gt;&apos;");
    expect(xml).not.toMatch(/<loc>[^<]*&(?!amp;|quot;|apos;|lt;|gt;)/);
  });

  it("omits lastmod when there is none and emits image entries", () => {
    const xml = renderSitemapXml([
      { loc: "https://namilux.ir/", lastmod: null },
      { loc: "https://namilux.ir/product/x/", lastmod: LEGACY_AT, images: ["https://namilux.ir/media/k.avif"] },
    ]);
    expect(xml).toContain("<url><loc>https://namilux.ir/</loc></url>");
    expect(xml).toContain(`<lastmod>${LEGACY_AT}</lastmod>`);
    expect(xml).toContain("<image:image><image:loc>https://namilux.ir/media/k.avif</image:loc></image:image>");
  });

  it("an empty child is still valid XML with zero urls", () => {
    const xml = renderSitemapXml([]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).toContain("</urlset>");
    expect(xml).not.toContain("<url>");
  });

  it("drops control characters that XML 1.0 cannot represent", () => {
    const hostile = `https://namilux.ir/product/${String.fromCharCode(7)}x/`;
    const xml = renderSitemapXml([{ loc: hostile, lastmod: null }]);
    expect(xml).toContain("<loc>https://namilux.ir/product/x/</loc>");
    expect(xml.includes(String.fromCharCode(7))).toBe(false);
  });
});

describe("renderIndexXml", () => {
  it("lists every child at the ROOT path Google already crawls", () => {
    const entries: SitemapIndexEntry[] = [
      { name: "post-sitemap.xml", lastmod: LEGACY_AT },
      { name: "collection-sitemap.xml", lastmod: SEEDED_AT },
    ];
    const xml = renderIndexXml(entries, ORIGIN);
    expect(xml).toContain("<loc>https://namilux.ir/post-sitemap.xml</loc>");
    expect(xml).toContain("<loc>https://namilux.ir/collection-sitemap.xml</loc>");
    expect(xml).not.toContain("/sitemaps/");
    expect(xml).toContain(`<lastmod>${SEEDED_AT}</lastmod>`);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });
});

// ── integration ────────────────────────────────────────────────────────────────────────────────

const INDEXABLE_ROBOTS = "follow, index, max-snippet:-1, max-video-preview:-1, max-image-preview:large";
const NOINDEX_ROBOTS = "noindex, nofollow, max-snippet:-1, max-video-preview:-1, max-image-preview:large";
const TOTAL_PRODUCTS = 541;
const BAD_DATE_PRODUCT_ID = 3;
const MEDIA_ID = "01J00000000000000000000MED";
const MEDIA_KEY = "2026/08/kettle-klf04.avif";

const legacyDate = new Date(LEGACY_AT);
const seededDate = new Date(SEEDED_AT);
const editedDate = new Date(EDITED_AT);
const publishedDate = new Date(PUBLISHED_AT);

type Snapshot = {
  product1: SitemapEntry[];
  product2: SitemapEntry[];
  product3: SitemapEntry[];
  category: SitemapEntry[];
  productCat: SitemapEntry[];
  post: SitemapEntry[];
  page: SitemapEntry[];
  brand: SitemapEntry[];
  collection: SitemapEntry[];
  index: SitemapIndexEntry[];
};

async function seedFixture(tx: Db): Promise<void> {
  // Transactional TRUNCATE: rolled back with the rest of the fixture, and the only way to make the
  // 200/200/141 split assertion independent of whatever another suite left behind.
  await tx.execute(
    sql`truncate table products, product_images, media, categories, brands, posts, pages, collections cascade`,
  );

  await tx.insert(brands).values([
    {
      id: 1,
      slug: "smeg",
      nameFa: "اسمگ",
      nameEn: "Smeg",
      robots: "index, follow",
      isActive: true,
      sort: 0,
      legacyLastmod: legacyDate,
      updatedAt: seededDate,
    },
    { id: 2, slug: "hidden-brand", nameFa: "پنهان", nameEn: "Hidden", isActive: false, sort: 1, updatedAt: seededDate },
    {
      id: 3,
      slug: "noindex-brand",
      nameFa: "بی‌ایندکس",
      nameEn: "Noindex",
      robots: NOINDEX_ROBOTS,
      sort: 2,
      updatedAt: seededDate,
    },
  ]);

  await tx.insert(categories).values([
    {
      id: 1,
      slug: "توستر-اسمگ",
      path: "توستر-اسمگ",
      name: "توستر اسمگ",
      robots: INDEXABLE_ROBOTS,
      inSitemap: true,
      status: "active",
      legacyLastmod: legacyDate,
      updatedAt: seededDate,
    },
    {
      id: 2,
      slug: "cat-noindex",
      path: "cat-noindex",
      name: "noindex",
      robots: NOINDEX_ROBOTS,
      inSitemap: true,
      status: "active",
      updatedAt: seededDate,
    },
    {
      id: 3,
      slug: "cat-not-in-sitemap",
      path: "cat-not-in-sitemap",
      name: "not in sitemap",
      robots: "index, follow",
      inSitemap: false,
      status: "active",
      updatedAt: seededDate,
    },
    {
      id: 4,
      slug: "محصولات-اسمگ",
      path: "محصولات-اسمگ",
      name: "محصولات اسمگ",
      robots: "index, follow",
      inSitemap: true,
      status: "archived",
      updatedAt: seededDate,
    },
  ]);

  const productRows: NewRow<typeof products>[] = [];
  for (let i = 1; i <= TOTAL_PRODUCTS; i += 1) {
    // id 3 is inserted below with a timestamp JavaScript cannot represent.
    if (i === BAD_DATE_PRODUCT_ID) continue;
    productRows.push({
      id: i,
      slug: `p-${i}`,
      name: `product ${i}`,
      displayName: `product ${i}`,
      brandId: 1,
      status: "active",
      visibility: "public",
      robots: INDEXABLE_ROBOTS,
      legacyLastmod: legacyDate,
      publishedAt: publishedDate,
      // id 1 is the only row a human touched after launch.
      updatedAt: i === 1 ? editedDate : seededDate,
    });
  }
  // Rows that must never be listed - placed after the 541 so a leak would show up in child 3.
  productRows.push(
    { id: 900, slug: "p-archived", name: "archived", displayName: "archived", status: "archived", updatedAt: seededDate },
    { id: 901, slug: "p-hidden", name: "hidden", displayName: "hidden", status: "active", visibility: "hidden", updatedAt: seededDate },
    { id: 902, slug: "p-link-only", name: "link", displayName: "link", status: "active", visibility: "link_only", updatedAt: seededDate },
    { id: 903, slug: "p-noindex", name: "noindex", displayName: "noindex", status: "active", robots: NOINDEX_ROBOTS, updatedAt: seededDate },
  );
  await tx.insert(products).values(productRows);

  // A real seeded row (product 54256) carries `published_at = 1404-08-04 10:22:00+03:25:44` - a
  // Jalali year with an LMT offset that the driver turns into an Invalid Date. Inserted raw
  // because the drizzle insert type only accepts a JS Date.
  await tx.execute(sql`
    insert into products (id, slug, name, display_name, brand_id, status, visibility, robots, published_at, updated_at)
    values (3, 'p-3', 'product 3', 'product 3', 1, 'active', 'public',
            'follow, index, max-snippet:-1, max-video-preview:-1, max-image-preview:large',
            '1404-08-04 10:22:00+03:25:44'::timestamptz, '2026-08-25T19:58:17.233Z'::timestamptz)
  `);

  await tx
    .insert(media)
    .values({ id: MEDIA_ID, kind: "image", storageKey: MEDIA_KEY, mime: "image/avif", bytes: 1234, source: "seed" });
  await tx.insert(productImages).values({ productId: 2, mediaId: MEDIA_ID, role: "primary", sort: 0 });

  await tx.insert(posts).values([
    {
      id: 1,
      slug: "معرفی-اسپرسوساز",
      title: "معرفی",
      status: "published",
      publishedAt: publishedDate,
      legacyLastmod: legacyDate,
      robots: INDEXABLE_ROBOTS,
      updatedAt: seededDate,
    },
    { id: 2, slug: "draft-post", title: "draft", status: "draft", updatedAt: seededDate },
    { id: 3, slug: "noindex-post", title: "noindex", status: "published", robots: NOINDEX_ROBOTS, updatedAt: seededDate },
    {
      id: 4,
      slug: "scheduled-post",
      title: "scheduled",
      status: "published",
      publishedAt: new Date(Date.now() + 86_400_000),
      updatedAt: seededDate,
    },
  ]);

  await tx.insert(pages).values([
    // rules: the privacy/terms templates ARE included.
    {
      id: 1,
      slug: "حریم-خصوصی-کاربران",
      title: "حریم خصوصی",
      template: "privacy",
      status: "published",
      robots: "index, follow",
      legacyLastmod: legacyDate,
      updatedAt: seededDate,
    },
    { id: 2, slug: "cart", title: "cart", status: "archived", robots: "noindex, follow", updatedAt: seededDate },
    { id: 3, slug: "faq", title: "faq", template: "faq", status: "draft", updatedAt: seededDate },
    { id: 4, slug: "noindex-page", title: "noindex", status: "published", robots: NOINDEX_ROBOTS, updatedAt: seededDate },
  ]);

  await tx.insert(collections).values([
    { id: 1, slug: "coffee-and-drinks", name: "قهوه", kind: "group", status: "active", sort: 0, createdAt: seededDate, updatedAt: seededDate },
    { id: 2, slug: "draft-collection", name: "پیش‌نویس", kind: "group", status: "draft", sort: 1, updatedAt: seededDate },
    {
      id: 3,
      slug: "ended-campaign",
      name: "پایان‌یافته",
      kind: "group",
      status: "active",
      sort: 2,
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: new Date("2026-02-01T00:00:00.000Z"),
      updatedAt: seededDate,
    },
  ]);
}

let testDb: TestDb | null = null;
let snap: Snapshot | null = null;

beforeAll(async () => {
  if (!hasTestDb()) return;
  testDb = await createTestDb();
  await withTestTx(testDb.db, async (tx) => {
    await seedFixture(tx);
    const ctx = { origin: ORIGIN, launchAt: LAUNCH };
    snap = {
      product1: await buildSitemap(tx, "product-sitemap1.xml", ctx),
      product2: await buildSitemap(tx, "product-sitemap2.xml", ctx),
      product3: await buildSitemap(tx, "product-sitemap3.xml", ctx),
      category: await buildSitemap(tx, "category-sitemap.xml", ctx),
      productCat: await buildSitemap(tx, "product_cat-sitemap.xml", ctx),
      post: await buildSitemap(tx, "post-sitemap.xml", ctx),
      page: await buildSitemap(tx, "page-sitemap.xml", ctx),
      brand: await buildSitemap(tx, "pa_brand-sitemap.xml", ctx),
      collection: await buildSitemap(tx, "collection-sitemap.xml", ctx),
      index: await sitemapIndex(tx, ctx),
    };
  });
}, 180_000);

afterAll(async () => {
  await testDb?.close();
  testDb = null;
});

const snapshot = (): Snapshot => {
  if (snap === null) throw new Error("fixture did not run");
  return snap;
};

describe.skipIf(!hasTestDb())("[db] buildSitemap", () => {
  it("products split 200/200/141", () => {
    const s = snapshot();
    expect(s.product1).toHaveLength(200);
    expect(s.product2).toHaveLength(200);
    expect(s.product3).toHaveLength(141);
    expect(s.product1[0]?.loc).toBe("https://namilux.ir/product/p-1/");
    expect(s.product2[0]?.loc).toBe("https://namilux.ir/product/p-201/");
    expect(s.product3.at(-1)?.loc).toBe(`https://namilux.ir/product/p-${TOTAL_PRODUCTS}/`);
  });

  it("archived, hidden, link-only and noindex products are never listed", () => {
    const s = snapshot();
    const all = [...s.product1, ...s.product2, ...s.product3].map((e) => e.loc);
    for (const slug of ["p-archived", "p-hidden", "p-link-only", "p-noindex"]) {
      expect(all).not.toContain(`https://namilux.ir/product/${slug}/`);
    }
  });

  it("legacy lastmod is kept until the entity is edited after launch", () => {
    const s = snapshot();
    expect(s.product1[0]?.lastmod).toBe(EDITED_AT);
    expect(s.product1[1]?.lastmod).toBe(LEGACY_AT);
    for (const entry of [...s.product1, ...s.product2, ...s.product3]) {
      expect(entry.lastmod).not.toBeNull();
      expect(Number.isNaN(Date.parse(entry.lastmod ?? ""))).toBe(false);
    }
  });

  it("a timestamp JavaScript cannot represent falls through instead of throwing", () => {
    const s = snapshot();
    // id 3 has no legacy lastmod and an unrepresentable published_at → updated_at wins.
    expect(s.product1[2]?.loc).toBe(`https://namilux.ir/product/p-${BAD_DATE_PRODUCT_ID}/`);
    expect(s.product1[2]?.lastmod).toBe(SEEDED_AT);
  });

  it("attaches the primary image of a product", () => {
    const s = snapshot();
    const withImage = s.product1.find((e) => e.loc === "https://namilux.ir/product/p-2/");
    expect(withImage?.images).toEqual([`https://namilux.ir/media/${MEDIA_KEY}`]);
    expect(s.product1[0]?.images).toBeUndefined();
  });

  it("noindex and non-sitemap categories are excluded", () => {
    const s = snapshot();
    expect(s.productCat).toHaveLength(1);
    // Persian paths are emitted percent-encoded, lowercase hex, trailing slash.
    expect(s.productCat[0]?.loc).toBe(
      "https://namilux.ir/category/%d8%aa%d9%88%d8%b3%d8%aa%d8%b1-%d8%a7%d8%b3%d9%85%da%af/",
    );
    expect(s.productCat[0]?.lastmod).toBe(LEGACY_AT);
  });

  it("the legacy category child is served empty (its only URL is a redirect now)", () => {
    expect(snapshot().category).toEqual([]);
  });

  it("posts: drafts, noindex and scheduled posts drop out; /blog/ leads the child", () => {
    const s = snapshot();
    expect(s.post[0]).toEqual({ loc: "https://namilux.ir/blog/", lastmod: null });
    expect(s.post).toHaveLength(2);
    expect(s.post[1]?.loc.startsWith("https://namilux.ir/%d9%85")).toBe(true);
    expect(s.post[1]?.lastmod).toBe(LEGACY_AT);
  });

  it("pages: the indexable static routes lead, privacy/terms are included, drafts are not", () => {
    const s = snapshot();
    expect(s.page.slice(0, 5).map((e) => e.loc)).toEqual([
      "https://namilux.ir/",
      "https://namilux.ir/shop/",
      "https://namilux.ir/discount/",
      "https://namilux.ir/new/",
      "https://namilux.ir/gifts/",
    ]);
    expect(s.page).toHaveLength(6);
    expect(s.page[5]?.lastmod).toBe(LEGACY_AT);
  });

  it("brands: inactive and noindex brands drop out", () => {
    const s = snapshot();
    expect(s.brand).toEqual([{ loc: "https://namilux.ir/brand/smeg/", lastmod: LEGACY_AT }]);
  });

  it("collections: drafts and closed campaign windows drop out", () => {
    const s = snapshot();
    expect(s.collection).toEqual([
      { loc: "https://namilux.ir/collection/coffee-and-drinks/", lastmod: SEEDED_AT },
    ]);
  });

  it("no disallowed path is ever listed", () => {
    const s = snapshot();
    const all = [
      ...s.product1,
      ...s.product2,
      ...s.product3,
      ...s.category,
      ...s.productCat,
      ...s.post,
      ...s.page,
      ...s.brand,
      ...s.collection,
    ];
    for (const entry of all) {
      for (const path of ROBOTS_DISALLOW) expect(entry.loc.startsWith(`${ORIGIN}${path}`)).toBe(false);
    }
  });
});

describe.skipIf(!hasTestDb())("[db] sitemapIndex", () => {
  it("lists every child, including the empty ones", () => {
    const s = snapshot();
    expect(s.index.map((e) => e.name)).toEqual([...SITEMAP_CHILDREN]);
  });

  it("each lastmod is the newest entry of its child and is never Invalid Date", () => {
    const s = snapshot();
    const byName = new Map(s.index.map((e) => [e.name, e.lastmod]));
    expect(byName.get("product-sitemap1.xml")).toBe(EDITED_AT);
    expect(byName.get("product-sitemap2.xml")).toBe(LEGACY_AT);
    for (const entry of s.index) {
      expect(Number.isNaN(Date.parse(entry.lastmod))).toBe(false);
      expect(entry.lastmod).not.toContain("Invalid");
    }
  });

  it("an empty child inherits the newest date in the index rather than the build date", () => {
    const s = snapshot();
    const byName = new Map(s.index.map((e) => [e.name, e.lastmod]));
    expect(byName.get("category-sitemap.xml")).toBe(EDITED_AT);
  });

  it("renders an index whose children are the root URLs Google knows", () => {
    const xml = renderIndexXml(snapshot().index, ORIGIN);
    for (const name of SITEMAP_CHILDREN) expect(xml).toContain(`<loc>https://namilux.ir/${name}</loc>`);
  });
});
