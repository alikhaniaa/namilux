import { describe, expect, it } from "vitest";
import {
  ORIGIN_RE,
  brandPath,
  collectionPath,
  decodeSlug,
  ensureUniqueSlug,
  productPath,
  rootPath,
  slugifyEn,
  toPath,
} from "../slugs.js";

describe("toPath", () => {
  it("toPath origin+slash: strips the origin and adds the trailing slash", () => {
    expect(toPath("https://namilux.ir/brand/dyson")).toBe("/brand/dyson/");
    expect(toPath("https://www.namilux.ir/brand/dyson/")).toBe("/brand/dyson/");
    expect(toPath("http://namilux.ir/shop/")).toBe("/shop/");
    expect(toPath("brand/dyson")).toBe("/brand/dyson/");
    expect(toPath("/")).toBe("/");
  });

  it("file-like keeps extension: /locations.kml never gets a trailing slash", () => {
    expect(toPath("https://namilux.ir/locations.kml")).toBe("/locations.kml");
    expect(toPath("/sitemap.xml")).toBe("/sitemap.xml");
  });

  it("hex case insensitive: %d8%a2 and %D8%A2 decode identically", () => {
    const lower = toPath("/category/%d8%a2%d8%b3%db%8c%d8%a7%d8%a8-%d9%82%d9%87%d9%88%d9%87-%d8%a7%d8%b3%d9%85%da%af/");
    const upper = toPath("/category/%D8%A2%D8%B3%DB%8C%D8%A7%D8%A8-%D9%82%D9%87%D9%88%D9%87-%D8%A7%D8%B3%D9%85%DA%AF/");
    expect(lower).toBe(upper);
    expect(lower).toBe("/category/آسیاب-قهوه-اسمگ/");
  });

  it("bad escape tolerated: a truncated escape is returned as-is with a trailing slash", () => {
    expect(() => toPath("/product/%E0%A4%A/")).not.toThrow();
    expect(toPath("/product/%E0%A4%A/")).toBe("/product/%E0%A4%A/");
    expect(decodeSlug("%E0%A4%A")).toBe("%E0%A4%A");
  });

  it("query stripped: the wpnonce query and any hash are removed", () => {
    expect(toPath("/my-account/customer-logout/?_wpnonce=1bb32f719d")).toBe("/my-account/customer-logout/");
    expect(toPath("https://namilux.ir/shop/#top")).toBe("/shop/");
    expect(toPath("https://namilux.ir/#")).toBe("/");
  });

  it("ORIGIN_RE matches both hosts and both schemes", () => {
    expect(ORIGIN_RE.test("https://namilux.ir/x")).toBe(true);
    expect(ORIGIN_RE.test("http://www.namilux.ir/x")).toBe(true);
    expect(ORIGIN_RE.test("https://example.com/x")).toBe(false);
  });
});

describe("slugifyEn", () => {
  it("slugifyEn table", () => {
    const table: [string, string][] = [
      ["Stylers / Airwrap", "stylers-airwrap"],
      ["Kitchen & tableware", "kitchen-and-tableware"],
      ["Coffee & Drinks", "coffee-and-drinks"],
      ["Vacuums & steam", "vacuums-and-steam"],
      ["Food prep", "food-prep"],
      ["  Air quality  ", "air-quality"],
      ["", "x"],
      ["///", "x"],
    ];
    for (const [input, expected] of table) expect(slugifyEn(input)).toBe(expected);
  });
});

describe("ensureUniqueSlug", () => {
  it("ensureUniqueSlug suffixes: free slug, prefixed slug, then -2/-3", () => {
    const taken = new Set<string>();
    expect(ensureUniqueSlug("juicers", taken)).toBe("juicers");
    expect(ensureUniqueSlug("juicers", taken, "cooking")).toBe("cooking-juicers");
    expect(ensureUniqueSlug("juicers", taken)).toBe("juicers-2");
    expect(ensureUniqueSlug("juicers", taken)).toBe("juicers-3");
    expect(taken.has("cooking-juicers")).toBe(true);
  });
});

describe("entity paths", () => {
  it("build decoded paths for every URL-bearing entity", () => {
    expect(productPath("توستر-اسمگ")).toBe("/product/توستر-اسمگ/");
    expect(brandPath("dyson")).toBe("/brand/dyson/");
    expect(rootPath("about-us")).toBe("/about-us/");
    expect(collectionPath("coffee-and-drinks")).toBe("/collection/coffee-and-drinks/");
  });
});
