import { describe, expect, it } from "vitest";
import {
  dedupeTags,
  tagsForBannerChange,
  tagsForBrandChange,
  tagsForCategoryChange,
  tagsForCollectionChange,
  tagsForMenuChange,
  tagsForPageChange,
  tagsForPostChange,
  tagsForProductChange,
  tagsForSettingsChange,
} from "../invalidation";
import { isCacheTag, tags } from "../tags";

const PRODUCT = { id: 12, categoryIds: [3, 4], brandId: 7, collectionIds: [9], modelSiblingIds: [13] };

describe("cache invalidation", () => {
  it("price change hits product, category, brand, collection, home, catalog, search-index", () => {
    const out = tagsForProductChange(PRODUCT, "price");
    expect(out).toEqual(
      [
        tags.product(12),
        tags.product(13),
        tags.category(3),
        tags.category(4),
        tags.brand(7),
        tags.collection(9),
        tags.catalog,
        tags.search,
        tags.home,
      ].sort(),
    );
  });

  it("content change does not hit home", () => {
    const out = tagsForProductChange(PRODUCT, "content");
    expect(out).toEqual([tags.catalog, tags.product(12), tags.search].sort());
    expect(out).not.toContain(tags.home);
    expect(out).not.toContain(tags.sitemap);
  });

  it("archive adds sitemap", () => {
    const out = tagsForProductChange(PRODUCT, "status");
    expect(out).toContain(tags.sitemap);
    expect(out).toContain(tags.home);
    // An SEO edit refreshes the sitemap too, but never the home rails.
    const seo = tagsForProductChange(PRODUCT, "seo");
    expect(seo).toContain(tags.sitemap);
    expect(seo).not.toContain(tags.home);
  });

  it("a product with no categories, brand or collections still gets the family tags", () => {
    const out = tagsForProductChange(
      { id: 1, categoryIds: [], brandId: null, collectionIds: [] },
      "price",
    );
    expect(out).toEqual([tags.catalog, tags.home, tags.product(1), tags.search].sort());
  });

  it("menu change hits nav", () => {
    expect(tagsForMenuChange("header")).toEqual([tags.menu("header"), tags.nav].sort());
  });

  it("output is deduped and sorted", () => {
    const out = dedupeTags([tags.catalog, tags.home, tags.catalog, "", tags.home, tags.nav]);
    expect(out).toEqual(["catalog", "home", "nav"]);
    expect(out).toEqual([...out].sort());
    // Every emitted tag is a shape /api/internal/revalidate accepts.
    expect(tagsForProductChange(PRODUCT, "price").every((t) => isCacheTag(t))).toBe(true);
  });

  it("callers may mutate the returned array (pages/posts push onto it)", () => {
    const out = tagsForPageChange("gaaranti");
    out.push(tags.nav);
    expect(out).toContain(tags.nav);
    expect(tagsForPageChange("gaaranti")).not.toContain(tags.nav);
  });

  it("category change carries the parent, nav, catalog and sitemap", () => {
    expect(tagsForCategoryChange({ id: 5, parentId: 2 })).toEqual(
      [tags.category(5), tags.category(2), tags.nav, tags.catalog, tags.sitemap].sort(),
    );
    expect(tagsForCategoryChange({ id: 5, parentId: null })).toEqual(
      [tags.category(5), tags.nav, tags.catalog, tags.sitemap].sort(),
    );
  });

  it("brand and collection changes match what the catalogue writers already return", () => {
    expect(tagsForBrandChange(7)).toEqual(
      [tags.brand(7), tags.nav, tags.catalog, tags.home, tags.sitemap].sort(),
    );
    expect(tagsForCollectionChange(9, true)).toContain(tags.nav);
    expect(tagsForCollectionChange(9, false)).not.toContain(tags.nav);
  });

  it("post change hits home, page change does not", () => {
    expect(tagsForPostChange("post-slug")).toEqual(
      [tags.post("post-slug"), tags.content, tags.home, tags.sitemap].sort(),
    );
    expect(tagsForPageChange("page-slug")).toEqual(
      [tags.page("page-slug"), tags.content, tags.sitemap].sort(),
    );
  });

  it("banner change follows the slot and its targeting", () => {
    expect(tagsForBannerChange("home_hero")).toEqual([tags.content, tags.home].sort());
    expect(tagsForBannerChange("promo_bar")).toEqual([tags.content, tags.home, tags.nav].sort());
    expect(tagsForBannerChange("pdp_band")).toEqual([tags.catalog, tags.content].sort());
    expect(tagsForBannerChange("plp_inline", { brandId: 7, collectionId: 9 })).toEqual(
      [tags.catalog, tags.content, tags.brand(7), tags.collection(9)].sort(),
    );
    expect(tagsForBannerChange("ig_landing", { brandId: null })).toEqual([tags.content]);
  });

  it("settings change adds home and nav only for shell-rendered prefixes", () => {
    expect(tagsForSettingsChange("store.phone")).toEqual([tags.settings, tags.home, tags.nav].sort());
    expect(tagsForSettingsChange("promo.bar")).toContain(tags.nav);
    expect(tagsForSettingsChange("seo.title")).toContain(tags.home);
    expect(tagsForSettingsChange("checkout.enabled")).toEqual([tags.settings]);
  });
});
