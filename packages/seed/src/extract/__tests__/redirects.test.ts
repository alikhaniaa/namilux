import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { extractPath, resolveExtractDir } from "../paths.js";
import {
  FIXED_REDIRECTS,
  type InventoryRow,
  MY_ACCOUNT_FALLBACK,
  STATIC_SERVED_PATHS,
  computeRedirects,
  productCategoryCourtesy,
  readInventory,
  servedPaths,
} from "../redirects.js";
import { type LegacyCategory, readLegacyCategories } from "../categories.js";
import { readLegacyProducts } from "../products.js";
import { readLegacyBrands } from "../brands.js";

const dir = resolveExtractDir();
const hasExtract = existsSync(extractPath(dir, "inventoryCsv"));

function inv(path: string, type: InventoryRow["type"] = "page/post"): InventoryRow {
  return { path, type, status: 200, action: "KEEP", newUrl: null };
}

describe("pure rules", () => {
  it("fixed rows present with the DECIDED targets", () => {
    const map = new Map(FIXED_REDIRECTS.map((r) => [r.from, r]));
    expect(map.get("/checkout/")?.to).toBe("/billing/");
    expect(map.get("/my-account/orders/")?.to).toBe("/account/orders/");
    expect(map.get("/my-account/edit-address/")?.to).toBe("/account/addresses/");
    expect(map.get("/category/بلاگ/")?.to).toBe("/blog/");
    expect(map.get("/category/محصولات-اسمگ/")?.to).toBe("/brand/smeg/");
    expect(map.get("/تست/")?.to).toBe("/");
    expect(FIXED_REDIRECTS).toHaveLength(12);
  });

  it("kml is 410 with an empty target", () => {
    const kml = FIXED_REDIRECTS.find((r) => r.from === "/locations.kml");
    expect(kml?.code).toBe(410);
    expect(kml?.to).toBe("");
  });

  it("my-account fallback catches any other /my-account/* path", () => {
    const { redirects, unmatched } = computeRedirects({
      inventory: [inv("/my-account/lost-password/"), inv("/my-account/orders/")],
      served: new Set<string>(),
      categories: [],
    });
    expect(redirects.find((r) => r.from === "/my-account/lost-password/")?.to).toBe(MY_ACCOUNT_FALLBACK);
    // The fixed row wins for a path that is already named.
    expect(redirects.find((r) => r.from === "/my-account/orders/")?.to).toBe("/account/orders/");
    expect(unmatched).toEqual([]);
  });

  it("served paths never redirected", () => {
    const served = servedPaths({
      productSlugs: ["kettle"],
      categoryPaths: ["/category/a/"],
      brandSlugs: ["dyson"],
      postSlugs: ["a-post"],
      publishedPageSlugs: ["about-us"],
    });
    expect(served.has("/product/kettle/")).toBe(true);
    expect(served.has("/brand/dyson/")).toBe(true);
    expect(served.has("/a-post/")).toBe(true);
    expect(served.has("/about-us/")).toBe(true);
    expect(served.has("/wishlist/")).toBe(true);
    for (const p of STATIC_SERVED_PATHS) expect(served.has(p)).toBe(true);

    const { redirects } = computeRedirects({
      inventory: [inv("/product/kettle/", "product"), inv("/wishlist/")],
      served,
      categories: [],
    });
    expect(redirects.some((r) => r.from === "/product/kettle/")).toBe(false);
    expect(redirects.some((r) => r.from === "/wishlist/")).toBe(false);
  });

  it("servedPaths accepts the DB path form too", () => {
    const served = servedPaths({
      productSlugs: [],
      categoryPaths: ["توستر-اسمگ/توستر-کوچک-اسمگ"],
      brandSlugs: [],
      postSlugs: [],
      publishedPageSlugs: [],
    });
    expect(served.has("/category/توستر-اسمگ/توستر-کوچک-اسمگ/")).toBe(true);
  });

  it("unknown root path lands in unmatched instead of being sent to /", () => {
    const { redirects, unmatched } = computeRedirects({
      inventory: [inv("/some-orphan-page/")],
      served: new Set<string>(),
      categories: [],
    });
    expect(unmatched).toEqual(["/some-orphan-page/"]);
    expect(redirects.some((r) => r.from === "/some-orphan-page/")).toBe(false);
  });

  it("dedupe by from (first wins) and from === to dropped", () => {
    const { redirects } = computeRedirects({
      inventory: [inv("/category/x/", "category"), inv("/category/x/", "category")],
      served: new Set<string>(),
      categories: [{ path: "/category/x/" }],
    });
    expect(redirects.filter((r) => r.from === "/category/x/")).toHaveLength(1);
    // The courtesy row for /category/x/ is /product-category/x/ → never equal to its target.
    expect(redirects.every((r) => r.from !== r.to)).toBe(true);
  });

  it("a category path absent from categories.csv still redirects, with a distinct reason", () => {
    const { redirects } = computeRedirects({
      inventory: [inv("/category/ghost/", "category")],
      served: new Set<string>(),
      categories: [],
    });
    const row = redirects.find((r) => r.from === "/category/ghost/");
    expect(row?.to).toBe("/shop/");
    expect(row?.reason).toContain("absent from categories.csv");
  });

  it("product and brand gaps fall back to /shop/", () => {
    const { redirects } = computeRedirects({
      inventory: [inv("/product/gone/", "product"), inv("/brand/gone/", "brand")],
      served: new Set<string>(),
      categories: [],
    });
    expect(redirects.find((r) => r.from === "/product/gone/")?.to).toBe("/shop/");
    expect(redirects.find((r) => r.from === "/brand/gone/")?.to).toBe("/shop/");
  });

  it("courtesy count equals categories", () => {
    const cats = [{ path: "/category/a/" }, { path: "/category/a/b/" }, { path: "/not-a-category/" }];
    const courtesy = productCategoryCourtesy(cats);
    expect(courtesy).toHaveLength(2);
    expect(courtesy[0]).toMatchObject({ from: "/product-category/a/", to: "/category/a/", code: 301 });
    expect(courtesy[1]?.from).toBe("/product-category/a/b/");
  });
});

describe.skipIf(!hasExtract)("real 752-URL inventory", () => {
  let inventory: InventoryRow[];
  let categories: LegacyCategory[];
  let served: Set<string>;

  beforeAll(async () => {
    inventory = await readInventory(dir);
    categories = (await readLegacyCategories(dir)).categories;
    const products = await readLegacyProducts(dir);
    const brands = await readLegacyBrands(dir);
    served = servedPaths({
      productSlugs: products.products.map((p) => p.slug),
      categoryPaths: categories.map((c) => c.path),
      brandSlugs: brands.map((b) => b.slug),
      // Post slugs come from the inventory itself here so this suite does not depend on posts.ts.
      postSlugs: inventory
        .filter((r) => r.type === "page/post" && /^\/[^/]+\/$/.test(r.path))
        .map((r) => r.path.slice(1, -1)),
      publishedPageSlugs: ["about-us", "contact-us", "حریم-خصوصی-کاربران", "قوانین-و-مقررات-نامی-لوکس"],
    });
  });

  it("reads all 752 inventory rows", () => {
    expect(inventory).toHaveLength(752);
    expect(inventory.every((r) => r.path.startsWith("/"))).toBe(true);
    expect(inventory.filter((r) => r.path === "/locations.kml")).toHaveLength(1);
  });

  it("≥ 20 rows on the real inventory shape and unmatched is empty", () => {
    const { redirects, unmatched } = computeRedirects({ inventory, served, categories });
    expect(unmatched).toEqual([]);
    expect(redirects.length).toBeGreaterThanOrEqual(20);
    // 12 fixed + one courtesy row per category.
    expect(redirects).toHaveLength(FIXED_REDIRECTS.length + categories.length);
    expect(new Set(redirects.map((r) => r.from)).size).toBe(redirects.length);
  });

  it("every inventory path is either served or redirected", () => {
    const { redirects } = computeRedirects({ inventory, served, categories });
    const from = new Set(redirects.map((r) => r.from));
    for (const row of inventory) {
      expect(served.has(row.path) || from.has(row.path)).toBe(true);
    }
  });
});
