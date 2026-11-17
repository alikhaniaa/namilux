import { describe, expect, it } from "vitest";

import { MENUS, PAGE_SKELETONS } from "../importers/fixtures.js";

/**
 * A `kind: "page"` menu item is looked up by `ref`, which is the page's SLUG - and
 * `resolveMenuItem` DROPS an item whose ref matches no published page instead of failing loudly.
 * That is how «ارسال و مرجوعی» disappeared from the footer of every storefront page: its ref was
 * "returns", the page's template name, while the skeleton is slugged "shipping-returns".
 *
 * The legacy pages the importer brings over from the old site (about-us, contact-us) are not in
 * PAGE_SKELETONS, so they are listed here by name - the point of the test is that a ref is a slug
 * somebody has checked, not a template name somebody assumed.
 */
const LEGACY_PAGE_SLUGS = new Set(["about-us", "contact-us"]);

describe("menu fixtures", () => {
  const skeletonSlugs = new Set(PAGE_SKELETONS.map((p) => p.slug));

  it("every page item points at a page slug that exists", () => {
    const unresolved: string[] = [];
    for (const [menu, items] of Object.entries(MENUS)) {
      for (const item of items) {
        if (item.kind !== "page") continue;
        const ref = typeof item.ref === "string" ? item.ref : "";
        if (!skeletonSlugs.has(ref) && !LEGACY_PAGE_SLUGS.has(ref)) unresolved.push(`${menu}: «${item.label}» → ref "${ref}"`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  it("a page item's href is the slug's own URL, so the admin list shows where it goes", () => {
    const wrong: string[] = [];
    for (const [menu, items] of Object.entries(MENUS)) {
      for (const item of items) {
        if (item.kind !== "page") continue;
        if (item.href !== `/${String(item.ref)}/`) wrong.push(`${menu}: «${item.label}» href=${item.href} ref=${String(item.ref)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("the mobile tab bar is exactly four url items with no children", () => {
    expect(MENUS.tabbar).toHaveLength(4);
    for (const item of MENUS.tabbar) {
      expect(item.kind).toBe("url");
      expect(item.children).toBeUndefined();
    }
  });
});
