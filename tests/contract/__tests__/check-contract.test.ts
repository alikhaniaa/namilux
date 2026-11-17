import { describe, expect, it } from "vitest";
import {
  STATIC_ROUTES,
  checkCoverage,
  coverageFor,
  emptyRouteIndex,
  formatReport,
  indexRedirect,
  loadEnvLocal,
  loadRouteIndex,
  normalizeInventoryPath,
  readInventory,
} from "../check-contract";
import type { InventoryRow, RouteIndex } from "../check-contract";
import { brands, categories, pages, posts, products, redirects } from "@namilux/db";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";

loadEnvLocal();

const inventory = readInventory();

/** Everything the seed must produce, derived from the ground truth itself. */
function indexFromInventory(rows: InventoryRow[]): RouteIndex {
  const index = emptyRouteIndex();
  for (const row of rows) {
    const p = normalizeInventoryPath(row.path);
    if (STATIC_ROUTES.has(p)) continue;
    const segs = p.split("/").filter((s) => s !== "");
    const [head = "", second = ""] = segs;
    if (head === "product" && segs.length === 2) index.products.add(second);
    else if (head === "category" && segs.length >= 2) index.categories.add(segs.slice(1).join("/"));
    else if (head === "brand" && segs.length === 2) index.brands.add(second);
    else if (p === "/locations.kml") indexRedirect(index, "/locations.kml", "/", 410);
    else if (p.startsWith("/my-account")) continue; // covered by pattern, never by a row
    else if (segs.length === 1) index.posts.add(head);
  }
  return index;
}

const row = (path: string, type = "page/post"): InventoryRow => ({
  oldUrl: `https://namilux.ir${path}`,
  path,
  type,
  status: 200,
  title: "",
  lastmod: "",
  action: "KEEP",
  newUrl: "",
});

describe("inventory", () => {
  it("reads all 752 inventory rows", () => {
    expect(inventory).toHaveLength(752);
    expect(inventory[0]?.path).toBe("/");
    expect(inventory.filter((r) => r.type === "product")).toHaveLength(540);
    expect(inventory.filter((r) => r.type === "category")).toHaveLength(43);
    expect(inventory.filter((r) => r.type === "brand")).toHaveLength(7);
  });

  it("normalizeInventoryPath ports v1 toPath", () => {
    expect(normalizeInventoryPath("https://namilux.ir/shop/")).toBe("/shop/");
    expect(normalizeInventoryPath("https://www.namilux.ir/shop")).toBe("/shop/");
    expect(normalizeInventoryPath("shop")).toBe("/shop/");
    expect(normalizeInventoryPath("/locations.kml")).toBe("/locations.kml");
    expect(normalizeInventoryPath("/product/%da%a9%d8%aa%d8%b1%db%8c/")).toBe("/product/کتری/");
    expect(normalizeInventoryPath("/shop/?page=2")).toBe("/shop/");
    // a malformed escape survives instead of throwing (DECISION in check-contract.ts)
    expect(normalizeInventoryPath("/x/%zz/")).toBe("/x/%zz/");
  });

  it("every inventory path decodes to a leading-slash path", () => {
    for (const r of inventory) {
      expect(normalizeInventoryPath(r.path).startsWith("/")).toBe(true);
    }
  });
});

describe("coverageFor / checkCoverage", () => {
  it("an index built from the inventory covers 752/752", () => {
    const report = checkCoverage(inventory, indexFromInventory(inventory));
    expect(report.total).toBe(752);
    expect(report.unique).toBe(751); // "/shop/" appears twice in the ground truth
    expect(report.missing).toBe(0);
    expect(report.covered).toBe(752);
    expect(report.byKind.product).toBe(540);
    expect(report.byKind.category).toBe(43);
    expect(report.byKind.brand).toBe(7);
    expect(report.byKind.pattern).toBe(1); // /my-account/
    expect(report.byKind.redirect).toBe(1); // /locations.kml → 410
    expect(formatReport(report)).toContain("CONTRACT OK");
  });

  it("empty index reports every row missing and names the row that would fix it", () => {
    const report = checkCoverage(inventory, emptyRouteIndex());
    expect(report.missing).toBe(752 - report.byKind.static - report.byKind.pattern);
    expect(report.missingByType["product"]).toBe(540);
    const product = report.results.find((r) => r.row.type === "product");
    expect(product?.coverage.kind).toBe("missing");
    expect(product?.coverage.expected).toMatch(/^products\.slug = '.+' with products\.status = 'active'$/);
    expect(formatReport(report)).toContain("CONTRACT FAILED");
  });

  it("static routes come from @namilux/core ROUTES", () => {
    const index = emptyRouteIndex();
    for (const p of ["/", "/shop/", "/blog/", "/cart/", "/compare/", "/wishlist/", "/billing/"]) {
      expect(coverageFor(p, index)).toEqual({ kind: "static" });
    }
  });

  it("a live entity wins over a stale redirect row", () => {
    const index = emptyRouteIndex();
    index.products.add("کتری-برقی");
    indexRedirect(index, "/product/کتری-برقی/", "/shop/", 301);
    expect(coverageFor("/product/کتری-برقی/", index)).toEqual({ kind: "product", key: "کتری-برقی" });
  });

  it("archived entity falls through to its redirect", () => {
    const index = emptyRouteIndex();
    indexRedirect(index, "/product/gone/", "/brand/smeg/", 301);
    expect(coverageFor("/product/gone/", index)).toEqual({ kind: "redirect", to: "/brand/smeg/", code: 301 });
  });

  it("redirects match encoded and decoded from_path, with or without the trailing slash", () => {
    const index = emptyRouteIndex();
    indexRedirect(index, "/category/%d8%a8%d9%84%d8%a7%da%af/", "/blog/", 301);
    expect(coverageFor("/category/بلاگ/", index).kind).toBe("redirect");
    expect(coverageFor("/category/بلاگ", index).kind).toBe("redirect");

    const gone = emptyRouteIndex();
    indexRedirect(gone, "/locations.kml", "/", 410);
    expect(coverageFor("/locations.kml", gone)).toEqual({ kind: "redirect", to: "/", code: 410 });
  });

  it("/my-account/* and legacy pagination are covered by pattern", () => {
    const index = emptyRouteIndex();
    expect(coverageFor("/my-account/", index)).toEqual({ kind: "pattern", to: "/account/", code: 301 });
    expect(coverageFor("/my-account/orders/", index)).toEqual({
      kind: "pattern",
      to: "/account/orders/",
      code: 301,
    });
    expect(coverageFor("/my-account/edit-address/", index)).toEqual({
      kind: "pattern",
      to: "/account/addresses/",
      code: 301,
    });
    expect(coverageFor("/shop/page/3/", index)).toEqual({ kind: "pattern", to: "/shop/?page=3", code: 301 });
    expect(coverageFor("/category/توستر/page/2/", index)).toEqual({
      kind: "pattern",
      to: "/category/توستر/?page=2",
      code: 301,
    });
  });

  it("an unknown path is missing and asks for a redirects row", () => {
    const c = coverageFor("/deep/unknown/path/", emptyRouteIndex());
    expect(c.kind).toBe("missing");
    expect(c.expected).toContain("redirects.from_path = '/deep/unknown/path/'");
  });

  it("posts resolve before pages in the root namespace", () => {
    const index = emptyRouteIndex();
    index.posts.add("about-us");
    index.pages.add("about-us");
    expect(coverageFor("/about-us/", index).kind).toBe("post");

    const onlyPage = emptyRouteIndex();
    onlyPage.pages.add("قوانین-و-مقررات-نامی-لوکس");
    expect(coverageFor("/قوانین-و-مقررات-نامی-لوکس/", onlyPage).kind).toBe("page");
  });

  it("formatReport caps the listing unless --all", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`/missing-${i}/`, "product"));
    const report = checkCoverage(rows, emptyRouteIndex());
    const capped = formatReport(report, { limit: 5 });
    expect(capped).toContain("… and 25 more (run with --all)");
    expect(formatReport(report, { all: true })).not.toContain("more (run with --all)");
    expect(formatReport(report, { head: ["HEAD LINE"] }).startsWith("HEAD LINE")).toBe(true);
  });
});

describe.skipIf(!hasTestDb())("loadRouteIndex [db]", () => {
  it("sees fixture rows inside a rolled-back transaction and covers a synthetic inventory", async () => {
    const test = await createTestDb({ migrate: false });
    try {
      await withTestTx(test.db, async (tx) => {
        await tx.insert(brands).values({ slug: "smeg", nameFa: "Smeg", nameEn: "Smeg", isActive: true });
        await tx.insert(brands).values({ slug: "gone-brand", nameFa: "Gone", nameEn: "Gone", isActive: false });
        await tx
          .insert(categories)
          .values({ slug: "کتری-برقی", path: "کتری-برقی", name: "Kettles", status: "active" });
        await tx
          .insert(products)
          .values({ slug: "کتری-برقی-اسمگ", name: "Kettle", displayName: "Kettle", status: "active" });
        await tx
          .insert(products)
          .values({ slug: "draft-product", name: "Draft", displayName: "Draft", status: "draft" });
        await tx.insert(posts).values({ slug: "آموزش-قهوه", title: "Coffee", status: "published" });
        await tx.insert(pages).values({ slug: "about-us", title: "About", status: "published" });
        await tx
          .insert(redirects)
          .values({ fromPath: "/locations.kml", toPath: "/", code: 410, source: "legacy", isActive: true });
        await tx.insert(redirects).values({
          fromPath: "/product/archived/",
          toPath: "/brand/smeg/",
          code: 301,
          source: "auto_archive",
          isActive: true,
        });
        await tx.insert(redirects).values({
          fromPath: "/product/disabled/",
          toPath: "/shop/",
          code: 301,
          source: "manual",
          isActive: false,
        });

        const index = await loadRouteIndex(tx);
        expect(index.brands.has("smeg")).toBe(true);
        expect(index.brands.has("gone-brand")).toBe(false);
        expect(index.products.has("کتری-برقی-اسمگ")).toBe(true);
        expect(index.products.has("draft-product")).toBe(false);
        expect(index.categories.has("کتری-برقی")).toBe(true);
        expect(index.posts.has("آموزش-قهوه")).toBe(true);
        expect(index.pages.has("about-us")).toBe(true);

        // "everything present": a synthetic inventory of exactly these URLs is 100 % covered.
        const synthetic: InventoryRow[] = [
          row("/"),
          row("/shop/"),
          row("/about-us/"),
          row("/آموزش-قهوه/"),
          row("/my-account/orders/"),
          row("/locations.kml"),
          row("/product/کتری-برقی-اسمگ/", "product"),
          row("/product/archived/", "product"),
          row("/category/کتری-برقی/", "category"),
          row("/brand/smeg/", "brand"),
        ];
        const ok = checkCoverage(synthetic, index);
        expect(ok.missing).toBe(0);
        expect(formatReport(ok)).toContain("CONTRACT OK");

        // an inactive redirect and a draft product are NOT coverage
        const gaps = checkCoverage(
          [row("/product/disabled/", "product"), row("/product/draft-product/", "product")],
          index,
        );
        expect(gaps.missing).toBe(2);
      });
    } finally {
      await test.close();
    }
  }, 60_000);
});
