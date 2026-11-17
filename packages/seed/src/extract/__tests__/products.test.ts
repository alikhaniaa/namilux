import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { extractPath, resolveExtractDir } from "../paths.js";
import {
  type LegacyProduct,
  imageRefs,
  parseDimensionsMm,
  parseToman,
  parseWeightG,
  pickBrand,
  pickCategories,
  pickColors,
  readLegacyProducts,
  saleFrom,
} from "../products.js";

const dir = resolveExtractDir();
const hasExtract = existsSync(extractPath(dir, "productsDir"));

describe("price helpers (pure)", () => {
  it("parseToman never divides (currency_minor_unit = 0)", () => {
    expect(parseToman("137000000")).toBe(137000000);
    expect(parseToman("1500000")).toBe(1500000);
    expect(parseToman(137000000)).toBe(137000000);
    expect(parseToman("0")).toBe(0);
    expect(parseToman("")).toBe(0);
    expect(parseToman(null)).toBe(0);
    expect(parseToman(undefined)).toBe(0);
    // WooCommerce formats thousands with "." - the digits are the amount, never a decimal.
    expect(parseToman("137.000.000")).toBe(137000000);
  });

  it("saleFrom compareAt rules", () => {
    expect(saleFrom({ price: "35700000", regular_price: "39000000", sale_price: "35700000" }, true)).toEqual({
      price: 35700000,
      compareAt: 39000000,
    });
    // on_sale false with sale === regular → no compareAt.
    expect(saleFrom({ price: "39000000", regular_price: "39000000", sale_price: "39000000" }, false)).toEqual({
      price: 39000000,
      compareAt: null,
    });
    // on_sale true but no real discount → no compareAt.
    expect(saleFrom({ price: "100", regular_price: "100", sale_price: "100" }, true).compareAt).toBeNull();
    expect(saleFrom({ price: "0", regular_price: "0", sale_price: "0" }, true)).toEqual({ price: 0, compareAt: null });
  });

  it("dimensions cm→mm and weight kg→g", () => {
    expect(parseDimensionsMm({ length: "28", width: "4", height: "4.5" })).toEqual({ length: 280, width: 40, height: 45 });
    expect(parseDimensionsMm({ length: "45", width: "45", height: "" })).toEqual({ length: 450, width: 450, height: null });
    // Already millimetres.
    expect(parseDimensionsMm({ length: "1200", width: "", height: "" })).toEqual({ length: 1200, width: null, height: null });
    expect(parseDimensionsMm({ length: "", width: "", height: "" })).toBeNull();
    expect(parseDimensionsMm(undefined)).toBeNull();

    expect(parseWeightG("1")).toBe(1000);
    expect(parseWeightG("1.3")).toBe(1300);
    expect(parseWeightG("2.56")).toBe(2560);
    expect(parseWeightG("3400")).toBe(3400);
    expect(parseWeightG("")).toBeNull();
    expect(parseWeightG(undefined)).toBeNull();
  });
});

describe("attribute helpers (pure)", () => {
  const brandTerm = { id: 52, name: "دایسون", slug: "dyson" };

  it("brand precedence: pa_brand → custom → commerce → curated → name", () => {
    const curated = {
      brandEn: "SMEG",
      brandFa: "اسمگ",
      groupEn: "Cooking",
      groupFa: "پخت و پز",
      subEn: "Ovens",
      subFa: "فر",
      collection: null,
      priceBand: "<5M",
    };
    const withPa = pickBrand(
      { name: "x tefal", attributes: [{ id: 1, name: "برند", taxonomy: "pa_brand", terms: [brandTerm] }] },
      { brands: [{ id: 257, name: "اسمگ", slug: "smeg" }] },
      curated,
    );
    expect(withPa).toMatchObject({ source: "pa_brand", slug: "dyson" });

    const withCustom = pickBrand(
      { name: "x", attributes: [{ id: 0, name: "برند", taxonomy: null, terms: [{ id: 0, name: "اسمگ", slug: "اسمگ" }] }] },
      null,
      curated,
    );
    expect(withCustom).toMatchObject({ source: "custom", slug: "smeg" });

    const withCommerce = pickBrand({ name: "x", attributes: [] }, { brands: [{ id: 257, name: "اسمگ", slug: "smeg" }] }, null);
    expect(withCommerce).toMatchObject({ source: "commerce_brands", slug: "smeg" });

    const withCurated = pickBrand({ name: "x", attributes: [] }, null, { ...curated, brandEn: "Sage / Breville" });
    expect(withCurated).toMatchObject({ source: "curated", slug: "sage" });

    const withName = pickBrand({ name: "tefal masterchop xxl خردکن", attributes: [] }, null, null);
    expect(withName).toMatchObject({ source: "name", slug: "tefal" });

    const unresolved = pickBrand({ name: "جارو رباتیک Roborock S8", attributes: [] }, null, { ...curated, brandEn: "Unidentified", brandFa: "نامشخص" });
    expect(unresolved).toMatchObject({ source: null, slug: null });
  });

  it("colour custom attribute not split on hyphen", () => {
    const custom = pickColors({
      attributes: [{ id: 0, name: "رنگ", taxonomy: null, terms: [{ id: 0, name: "سفید-طلایی", slug: "x" }] }],
    });
    expect(custom).toEqual({ colorNames: ["سفید-طلایی"], colorSource: "custom" });

    const multi = pickColors({
      attributes: [{ id: 0, name: "رنگ", taxonomy: null, terms: [{ id: 0, name: "سفید، مشکی / کرم", slug: "x" }] }],
    });
    expect(multi.colorNames).toEqual(["سفید", "مشکی", "کرم"]);

    const pa = pickColors({
      attributes: [{ id: 2, name: "رنگ", taxonomy: "pa_color", terms: [{ id: 59, name: "طوسی", slug: "%d8%b7%d9%88%d8%b3%db%8c" }] }],
    });
    expect(pa).toEqual({ colorNames: ["طوسی"], colorSource: "pa_color" });

    expect(pickColors({ attributes: [] })).toEqual({ colorNames: [], colorSource: null });
  });

  it("category fallback to wp when the Store API list is empty", () => {
    expect(pickCategories({ categories: [{ id: 53 }, { id: 230 }] }, { product_cat: [999] })).toEqual({
      categoryIds: [53, 230],
      categorySource: "commerce",
    });
    expect(pickCategories({ categories: [] }, { product_cat: [138] })).toEqual({
      categoryIds: [138],
      categorySource: "wp",
    });
    expect(pickCategories({ categories: [] }, { product_cat: [] })).toEqual({ categoryIds: [], categorySource: null });
  });

  it("imageRefs keeps gallery order and flags an unfetched url", () => {
    const refs = imageRefs("/nowhere", {
      images: [{ file: "images/01-a.jpg", url: "https://x/a.jpg", alt: "A" }, { file: "images/03-c.jpg", url: "https://x/c.jpg", alt: "" }],
      image_urls: ["https://x/a.jpg", "https://x/b.jpg", "https://x/c.jpg"],
    });
    expect(refs.map((r) => r.n)).toEqual([1, 2, 3]);
    expect(refs[1]).toMatchObject({ n: 2, file: "", sourceUrl: "https://x/b.jpg", exists: false });
    expect(refs[0]?.alt).toBe("A");
  });
});

describe.skipIf(!hasExtract)("real 541-product extract", () => {
  let products: LegacyProduct[];
  let warnings: string[];
  let byId: Map<number, LegacyProduct>;

  beforeAll(async () => {
    const res = await readLegacyProducts(dir);
    products = res.products;
    warnings = res.warnings;
    byId = new Map(products.map((p) => [p.id, p]));
  });

  it("returns all 541 ids with no warnings", () => {
    expect(products).toHaveLength(541);
    expect(warnings).toEqual([]);
    expect(new Set(products.map((p) => p.id)).size).toBe(541);
    expect(products.map((p) => p.id)).toEqual([...products.map((p) => p.id)].sort((a, b) => a - b));
  });

  it("preserves the 283 price-on-request products and the 129 discounts", () => {
    expect(products.filter((p) => p.onRequest)).toHaveLength(283);
    expect(products.filter((p) => p.price > 0)).toHaveLength(258);
    expect(products.filter((p) => p.onSale && p.salePrice > 0 && p.regularPrice > p.salePrice)).toHaveLength(129);
    const discounted = byId.get(117) as LegacyProduct;
    expect(saleFrom(
      { price: String(discounted.price), regular_price: String(discounted.regularPrice), sale_price: String(discounted.salePrice) },
      discounted.onSale,
    ).compareAt).toBe(39000000);
  });

  it("missing image file flagged not dropped (products 41546 and 48902)", () => {
    const only = byId.get(41546) as LegacyProduct;
    expect(only.images).toHaveLength(1);
    expect(only.images[0]).toMatchObject({ n: 1, exists: false });
    expect(only.images.some((i) => i.exists)).toBe(false);

    const partial = byId.get(48902) as LegacyProduct;
    expect(partial.images.map((i) => [i.n, i.exists])).toEqual([
      [1, true],
      [2, false],
      [3, true],
      [4, true],
      [5, true],
    ]);
    expect(products.filter((p) => p.images.some((i) => i.exists))).toHaveLength(295);
  });

  it("29 products fall back to the WP category list", () => {
    expect(products.filter((p) => p.categorySource === "wp")).toHaveLength(29);
    expect(products.filter((p) => p.categorySource === "commerce")).toHaveLength(512);
    expect(products.every((p) => p.categoryIds.length > 0)).toBe(true);
  });

  it("brand and colour sources match the documented data quirks", () => {
    const bySource = (s: LegacyProduct["brand"]["source"]) => products.filter((p) => p.brand.source === s).length;
    expect(bySource("pa_brand")).toBe(148);
    expect(bySource("custom")).toBe(47);
    expect(bySource("commerce_brands")).toBe(7);
    expect(bySource("curated")).toBe(306);
    // The 33 remaining are brands outside the 13 (EcoVacs, Roborock, Nutricook …).
    expect(bySource(null)).toBe(33);

    expect(products.filter((p) => p.colorSource === "pa_color")).toHaveLength(125);
    expect(products.filter((p) => p.colorSource === "custom")).toHaveLength(49);
    expect(products.every((p) => p.colorNames.every((c) => c.trim().length > 0))).toBe(true);
  });

  it("keeps the numeric low_stock_remaining for 24 products and null elsewhere", () => {
    expect(products.filter((p) => p.lowStockRemaining !== null)).toHaveLength(24);
    expect(products.every((p) => p.lowStockRemaining === null || Number.isInteger(p.lowStockRemaining))).toBe(true);
    expect(products.filter((p) => p.onBackorder)).toHaveLength(0);
  });

  it("dimensions and weights come from the Store API row", () => {
    expect(products.filter((p) => p.dimsMm)).toHaveLength(19);
    expect(products.filter((p) => p.weightG !== null)).toHaveLength(8);
    expect((byId.get(59427) as LegacyProduct).weightG).toBe(1300);
    expect((byId.get(28038) as LegacyProduct).weightG).toBe(3400);
  });

  it("flags the 4 descriptions that embed a video and the 340 empty SKUs", () => {
    expect(products.filter((p) => p.hasVideo).map((p) => p.id).sort((a, b) => a - b)).toEqual([51325, 57955, 62994, 63005]);
    expect(products.filter((p) => p.sku === null)).toHaveLength(340);
    expect(products.every((p) => p.sku === null || p.sku.length > 0)).toBe(true);
  });

  it("joins slug, path, dates and curated row per product", () => {
    const p = byId.get(1044) as LegacyProduct;
    expect(p.path).toBe(`/product/${p.slug}/`);
    expect(p.slug.includes("%")).toBe(false);
    expect(p.brand).toMatchObject({ source: "pa_brand", slug: "dyson", nameFa: "دایسون", nameEn: "Dyson" });
    expect(p.colorNames).toEqual(["طوسی"]);
    expect(p.categoryIds).toEqual([53, 230]);
    expect(p.publishedAt).toBe("2024-04-13T12:14:26Z");
    expect(p.modifiedAt?.endsWith("Z")).toBe(true);
    expect(p.specAttrs.length).toBe(8);
    // Spec attributes are left unsplit for transform/specs.ts.
    expect(p.specAttrs.some((s) => s.rawValue.includes(","))).toBe(true);
    expect(p.curated?.groupEn).toBe("Hair care");
  });

  it("limit takes smallest ids and only filters by allow-list", async () => {
    const limited = await readLegacyProducts(dir, { limit: 5 });
    expect(limited.products.map((p) => p.id)).toEqual(products.slice(0, 5).map((p) => p.id));

    const only = await readLegacyProducts(dir, { only: [48902, 1044] });
    expect(only.products.map((p) => p.id)).toEqual([1044, 48902]);
  });
});
