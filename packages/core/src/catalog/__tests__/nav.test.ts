import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { brands as brandsTable, media as mediaTable, productImages, products } from "@namilux/db";
import type { Db } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";

vi.mock("../../audit", () => ({
  MASKED_KEYS: [],
  jsonDiff: () => ({ before: null, after: null }),
  audit: {
    log: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 50 })),
  },
}));

import { getNavData, resolveMenuItem } from "../nav";
import type { NavBrand, NavCollection, NavLookups } from "../nav";
import type { MenuItem } from "../../content/menus";

const smeg: NavBrand = {
  slug: "smeg",
  name: "اسمگ",
  nameEn: "Smeg",
  count: 41,
  image: null,
  href: "/brand/smeg/",
};

const coffee: NavCollection = {
  slug: "coffee-and-drinks",
  name: "قهوه و نوشیدنی",
  count: 12,
  image: null,
  href: "/collection/coffee-and-drinks/",
  children: [],
};

const lookups: NavLookups = {
  // the map behind a real lookup is keyed by the LOWERCASE slug (getNavData builds it that way)
  brandBySlug: (s) => (s === "smeg" ? smeg : null),
  collectionBySlug: (s) => (s === "coffee-and-drinks" ? coffee : null),
  categoryByPath: (p) => (p === "توستر-اسمگ" ? { name: "توستر اسمگ", path: "توستر-اسمگ", count: 7 } : null),
  pageBySlug: (s) => (s === "warranty" ? { title: "گارانتی", slug: "warranty" } : null),
};

describe("resolveMenuItem - url items", () => {
  it("unsafe url dropped", () => {
    const unsafe: string[] = ["javascript:alert(1)", "//evil.example", "http://namilux.ir/x/", "", "data:,x"];
    for (const href of unsafe) {
      expect(resolveMenuItem({ label: "بد", href, kind: "url" }, lookups)).toBeNull();
    }
  });

  it("keeps a site-relative or https href and reports no count", () => {
    const item = resolveMenuItem({ label: "فروشگاه", href: "/shop/?avail=ready", kind: "url" }, lookups);
    expect(item).toEqual({
      label: "فروشگاه",
      kind: "url",
      href: "/shop/?avail=ready",
      count: null,
      image: null,
      children: [],
    });
    expect(resolveMenuItem({ label: "واتس‌اپ", href: "https://wa.me/98912", kind: "url" }, lookups)?.href).toBe(
      "https://wa.me/98912",
    );
  });

  it("drops an unsafe child without dropping its parent", () => {
    const item = resolveMenuItem(
      {
        label: "فروشگاه",
        href: "/shop/",
        kind: "url",
        children: [
          { label: "بد", href: "javascript:alert(1)", kind: "url" },
          { label: "خوب", href: "/discount/", kind: "url" },
        ],
      },
      lookups,
    );
    expect(item?.children.map((c) => c.href)).toEqual(["/discount/"]);
  });
});

describe("resolveMenuItem - entity items", () => {
  it("brand ref case-insensitive", () => {
    const item = resolveMenuItem({ label: "اسمگ", href: "/stale/", kind: "brand", ref: "SMEG" }, lookups);
    expect(item?.href).toBe("/brand/smeg/");
    expect(item?.count).toBe(41);
    expect(resolveMenuItem({ label: "دایسون", href: "", kind: "brand", ref: "dyson" }, lookups)).toBeNull();
  });

  it("ended campaign dropped", () => {
    // getNavData only puts LIVE collections in the lookup, so an ended campaign resolves to null
    expect(
      resolveMenuItem({ label: "کمپین", href: "/collection/nowruz/", kind: "collection", ref: "nowruz" }, lookups),
    ).toBeNull();
    expect(
      resolveMenuItem({ label: "قهوه", href: "", kind: "collection", ref: "coffee-and-drinks" }, lookups)?.href,
    ).toBe("/collection/coffee-and-drinks/");
  });

  it("resolves category and page items and counts only what is countable", () => {
    const category = resolveMenuItem({ label: "توستر", href: "", kind: "category", ref: "توستر-اسمگ" }, lookups);
    expect(category?.count).toBe(7);
    expect(category?.href.startsWith("/category/%")).toBe(true);

    const page = resolveMenuItem({ label: "گارانتی", href: "", kind: "page", ref: "warranty" }, lookups);
    expect(page?.href).toBe("/warranty/");
    // rules: count is null for url and page kinds
    expect(page?.count).toBeNull();
    expect(resolveMenuItem({ label: "حریم", href: "", kind: "page", ref: "privacy" }, lookups)).toBeNull();
  });

  it("drops a non-url item without a ref and an unknown kind", () => {
    expect(resolveMenuItem({ label: "اسمگ", href: "/brand/smeg/", kind: "brand" }, lookups)).toBeNull();
    expect(resolveMenuItem({ label: "؟", href: "/x/", kind: "widget" } as unknown as MenuItem, lookups)).toBeNull();
  });

  it("falls back to the entity name when the stored label is empty", () => {
    expect(resolveMenuItem({ label: "  ", href: "", kind: "brand", ref: "smeg" }, lookups)?.label).toBe("اسمگ");
  });
});

describe.skipIf(!hasTestDb())("getNavData against the database", () => {
  let handle: TestDb;

  beforeAll(async () => {
    handle = await createTestDb();
  });

  afterAll(async () => {
    await handle.close();
  });

  const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  /** A deterministic, syntactically valid ULID per fixture (no Math.random - the spec). */
  const ulidFor = (n: number): string => `01H${ULID_ALPHABET[n % 32] ?? "Z"}${"Z".repeat(22)}`;

  const addBrand = async (
    tx: Db,
    slug: string,
    nameEn: string,
    sort: number,
    logoMediaId: string | null = null,
  ): Promise<number> => {
    const [row] = await tx
      .insert(brandsTable)
      .values({ slug, nameFa: `برند ${nameEn}`, nameEn, sort, isActive: true, logoMediaId })
      .returning({ id: brandsTable.id });
    if (row === undefined) throw new Error("brand insert failed");
    return row.id;
  };

  const addProduct = async (
    tx: Db,
    i: { slug: string; brandId: number; price: number; compareAtPrice?: number; stockQty?: number },
  ): Promise<number> => {
    const [row] = await tx
      .insert(products)
      .values({
        slug: i.slug,
        name: i.slug,
        displayName: i.slug,
        brandId: i.brandId,
        status: "active",
        visibility: "public",
        price: i.price,
        compareAtPrice: i.compareAtPrice ?? null,
        stockPolicy: "track",
        stockQty: i.stockQty ?? 5,
      })
      .returning({ id: products.id });
    if (row === undefined) throw new Error("product insert failed");
    return row.id;
  };

  const addPrimaryImage = async (tx: Db, productId: number, mediaId: string, key: string): Promise<void> => {
    await tx.insert(mediaTable).values({
      id: mediaId,
      kind: "image",
      storageKey: key,
      mime: "image/jpeg",
      bytes: 1024,
      width: 800,
      height: 800,
      alt: "",
      renditionsJson: { master: key, avif: {}, webp: { "480": `${key}-480.webp` } },
      source: "seed",
    });
    await tx.insert(productImages).values({ productId, mediaId, role: "primary", sort: 0 });
  };

  it("missing menu key - every slot is [] when the menus table is empty", async () => {
    await withTestTx(handle.db, async (tx) => {
      const nav = await getNavData(tx);
      expect(nav.menus).toEqual({ header: [], drawer: [], footer_shop: [], footer_help: [], tabbar: [] });
      expect(nav.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(nav.counts.brands).toBe(nav.brands.length);
    });
  });

  it("brand ordering - brands with products first by count, then the coming-soon ones by sort", async () => {
    await withTestTx(handle.db, async (tx) => {
      const alpha = await addBrand(tx, "nav-alpha", "Alpha", 9);
      const beta = await addBrand(tx, "nav-beta", "Beta", 1);
      const gamma = await addBrand(tx, "nav-gamma", "Gamma", 5);
      await addProduct(tx, { slug: "nav-a1", brandId: alpha, price: 1_000_000 });
      await addProduct(tx, { slug: "nav-a2", brandId: alpha, price: 2_000_000 });
      await addProduct(tx, { slug: "nav-g1", brandId: gamma, price: 500_000 });
      expect(beta).toBeGreaterThan(0);

      const nav = await getNavData(tx);
      const mine = nav.brands.filter((b) => b.slug.startsWith("nav-")).map((b) => b.slug);
      // alpha (2 products) → gamma (1) → beta (0, "coming soon", ordered by sort)
      expect(mine).toEqual(["nav-alpha", "nav-gamma", "nav-beta"]);
      expect(nav.brands.find((b) => b.slug === "nav-alpha")?.count).toBe(2);
      expect(nav.brands.find((b) => b.slug === "nav-alpha")?.href).toBe("/brand/nav-alpha/");
    });
  });

  it("brand image fallback - the primary image of the highest-priced available product, else null", async () => {
    await withTestTx(handle.db, async (tx) => {
      const withArt = await addBrand(tx, "nav-art", "Art", 1);
      const bare = await addBrand(tx, "nav-bare", "Bare", 2);
      const cheap = await addProduct(tx, { slug: "nav-cheap", brandId: withArt, price: 1_000_000 });
      const dear = await addProduct(tx, { slug: "nav-dear", brandId: withArt, price: 9_000_000 });
      await addPrimaryImage(tx, cheap, ulidFor(1), "nav/cheap.jpg");
      await addPrimaryImage(tx, dear, ulidFor(2), "nav/dear.jpg");
      await addProduct(tx, { slug: "nav-bare-1", brandId: bare, price: 100_000 });

      const nav = await getNavData(tx);
      expect(nav.brands.find((b) => b.slug === "nav-art")?.image?.key).toBe("nav/dear.jpg");
      // EDGE CASE: no logo and no imaged product → image null
      expect(nav.brands.find((b) => b.slug === "nav-bare")?.image).toBeNull();
    });
  });

  it("onSale count semantics - a sale row counts even when it is out of stock", async () => {
    await withTestTx(handle.db, async (tx) => {
      const before = (await getNavData(tx)).counts;
      const brandId = await addBrand(tx, "nav-sale", "Sale", 1);
      await addProduct(tx, {
        slug: "nav-sale-1",
        brandId,
        price: 1_000_000,
        compareAtPrice: 2_000_000,
        stockQty: 0,
      });

      const after = (await getNavData(tx)).counts;
      expect(after.products - before.products).toBe(1);
      expect(after.onSale - before.onSale).toBe(1);
      // out of stock → not buyable
      expect(after.buyable - before.buyable).toBe(0);
      expect(after.brands - before.brands).toBe(1);
    });
  });
});
