import { describe, expect, it } from "vitest";
import { MAX_PURGE_URLS, PURGE_ALL_SENTINEL, urlsForTags } from "../urls";
import type { PurgeLookups } from "../urls";
import { tags } from "../tags";
import { SITEMAP_NAMES } from "../../constants";

const ORIGIN = "https://namilux.ir";

/** Every id resolves; a null answer is exercised separately. */
function lookups(overrides?: Partial<PurgeLookups>): PurgeLookups {
  return {
    productSlug: async (id) => (id === 12 ? "کتری-برقی" : `product-${id}`),
    categoryPath: async (id) => (id === 3 ? "توستر-اسمگ/توستر-کوچک-اسمگ" : `category-${id}`),
    brandSlug: async (id) => `brand-${id}`,
    collectionSlug: async (id) => `collection-${id}`,
    ...overrides,
  };
}

describe("urlsForTags", () => {
  it("product tag maps to the lowercase-percent-encoded product url", async () => {
    const out = await urlsForTags([tags.product(12)], lookups(), ORIGIN);
    expect(out).toEqual([
      "https://namilux.ir/product/%da%a9%d8%aa%d8%b1%db%8c-%d8%a8%d8%b1%d9%82%db%8c/",
    ]);
    // the spec: never an unencoded Persian path, never an uppercase hex escape.
    expect(out[0]).toMatch(/^[\x20-\x7e]+$/u);
    expect(out[0]).toBe(out[0]?.toLowerCase());
  });

  it("catalog tag maps to the shop family urls", async () => {
    const out = await urlsForTags([tags.catalog], lookups(), ORIGIN);
    expect(out).toEqual([
      "https://namilux.ir/shop/",
      "https://namilux.ir/discount/",
      "https://namilux.ir/new/",
      "https://namilux.ir/gifts/",
    ]);
  });

  it("more than 500 urls collapses to the '*' sentinel plus family urls", async () => {
    const many = Array.from({ length: MAX_PURGE_URLS + 20 }, (_, i) => tags.product(i + 1));
    const out = await urlsForTags([tags.catalog, ...many], lookups(), ORIGIN);
    expect(out[0]).toBe(PURGE_ALL_SENTINEL);
    expect(out).toEqual([
      PURGE_ALL_SENTINEL,
      "https://namilux.ir/shop/",
      "https://namilux.ir/discount/",
      "https://namilux.ir/new/",
      "https://namilux.ir/gifts/",
    ]);
  });

  it("urls are absolute and deduped", async () => {
    const out = await urlsForTags(
      [tags.home, tags.settings, tags.nav, tags.home, "", tags.menu("header")],
      lookups(),
      ORIGIN,
    );
    expect(out).toEqual(["https://namilux.ir/", "https://namilux.ir/shop/"]);
    expect(new Set(out).size).toBe(out.length);
    expect(out.every((u) => u.startsWith(ORIGIN))).toBe(true);
  });

  it("entity tags go through the url module; a null lookup yields nothing", async () => {
    const out = await urlsForTags(
      [tags.category(3), tags.brand(7), tags.collection(9), tags.post("blog-post"), tags.page("faq")],
      lookups(),
      ORIGIN,
    );
    expect(out).toContain(
      "https://namilux.ir/category/%d8%aa%d9%88%d8%b3%d8%aa%d8%b1-%d8%a7%d8%b3%d9%85%da%af/%d8%aa%d9%88%d8%b3%d8%aa%d8%b1-%da%a9%d9%88%da%86%da%a9-%d8%a7%d8%b3%d9%85%da%af/",
    );
    expect(out).toContain("https://namilux.ir/brand/brand-7/");
    expect(out).toContain("https://namilux.ir/collection/collection-9/");
    expect(out).toContain("https://namilux.ir/blog-post/");
    expect(out).toContain("https://namilux.ir/faq/");

    const missing = await urlsForTags(
      [tags.product(99)],
      lookups({ productSlug: async () => null }),
      ORIGIN,
    );
    expect(missing).toEqual([]);
  });

  it("sitemap tag purges the index and every legacy child", async () => {
    const out = await urlsForTags([tags.sitemap, tags.search], lookups(), ORIGIN);
    expect(out).toContain("https://namilux.ir/sitemap_index.xml");
    expect(out).toContain("https://namilux.ir/search-index.json");
    for (const name of SITEMAP_NAMES) expect(out).toContain(`https://namilux.ir/${name}`);
  });

  it("an unknown or malformed tag is ignored", async () => {
    const out = await urlsForTags(["not-a-tag", "product:abc", "product:", tags.home], lookups(), ORIGIN);
    expect(out).toEqual(["https://namilux.ir/"]);
  });
});
