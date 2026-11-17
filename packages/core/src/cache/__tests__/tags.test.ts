import { describe, expect, it } from "vitest";
import { STATIC_TAGS } from "../../constants";
import { isCacheTag, tags } from "../tags";

describe("tag builders", () => {
  it("builds the documented shapes", () => {
    expect(tags.catalog).toBe("catalog");
    expect(tags.settings).toBe("settings");
    expect(tags.content).toBe("content");
    expect(tags.sitemap).toBe("sitemap");
    expect(tags.nav).toBe("nav");
    expect(tags.home).toBe("home");
    expect(tags.search).toBe("search-index");
    expect(tags.product(12)).toBe("product:12");
    expect(tags.category(3)).toBe("category:3");
    expect(tags.brand(24)).toBe("brand:24");
    expect(tags.collection(7)).toBe("collection:7");
    expect(tags.post("kettle")).toBe("post:kettle");
    expect(tags.page("about")).toBe("page:about");
    expect(tags.menu("header")).toBe("menu:header");
  });

  it("every STATIC_TAGS member is a tag of this vocabulary", () => {
    for (const t of STATIC_TAGS) {
      expect(isCacheTag(t), t).toBe(true);
      expect(Object.values(tags)).toContain(t);
    }
  });
});

describe("isCacheTag", () => {
  it("isCacheTag accepts every tag shape and rejects junk", () => {
    const accepted = [
      tags.catalog,
      tags.settings,
      tags.content,
      tags.sitemap,
      tags.nav,
      tags.home,
      tags.search,
      tags.product(1),
      tags.product(1044),
      tags.category(12),
      tags.brand(24),
      tags.collection(7),
      tags.post("kettle-review"),
      tags.page("about"),
      tags.menu("footer_shop"),
    ];
    for (const t of accepted) expect(isCacheTag(t), t).toBe(true);

    const rejected = [
      "",
      " ",
      "catalog ",
      " catalog",
      "Catalog",
      "CATALOG",
      "catalogue",
      "search",
      "search-index2",
      "product",
      "product:",
      "product:abc",
      "product:-1",
      "product:1.5",
      "product:1:2",
      "Product:12",
      "category:",
      "unknown:12",
      "post:",
      "post:a b",
      "post:a/b",
      "menu:a\tb",
      "*",
      "product:*",
      `post:${"x".repeat(201)}`,
      "__proto__",
      "constructor",
    ];
    for (const t of rejected) expect(isCacheTag(t), JSON.stringify(t)).toBe(false);
  });

  it("post tag uses the decoded Persian slug", () => {
    const slug = "کتری-برقی";
    expect(tags.post(slug)).toBe(`post:${slug}`);
    expect(isCacheTag(tags.post(slug))).toBe(true);
    expect(tags.post(slug)).not.toContain("%");
    // the same slug percent-encoded is a different (wrong) tag - admin and web must agree on the
    // decoded form, so a caller that encodes produces a tag that never matches the emitted one.
    expect(tags.post(encodeURIComponent(slug))).not.toBe(tags.post(slug));
    expect(tags.page(slug)).toBe(`page:${slug}`);
    expect(isCacheTag(tags.page(slug))).toBe(true);
    expect(isCacheTag(tags.menu("سربرگ"))).toBe(true);
  });

  it("accepts a 200-char slug and refuses the 201st character", () => {
    expect(isCacheTag(`post:${"x".repeat(200)}`)).toBe(true);
    expect(isCacheTag(`post:${"x".repeat(201)}`)).toBe(false);
  });
});
