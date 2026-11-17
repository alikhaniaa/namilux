import { describe, expect, it } from "vitest";
import { CONTENT_STATUSES, MENU_KEYS, PAGE_TEMPLATES, ROBOTS_VALUES } from "../../constants";
import {
  MENU_MAX_CHILDREN,
  faqSchema,
  htmlField,
  menuItemSchema,
  menuSchema,
  pageSchema,
  postSchema,
  redirectSchema,
  robotsSchema,
  seoMetaSchema,
  slugParamSchema,
  type MenuItemInput,
} from "../content";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("post defaults and limits", () => {
  it("parses a minimal post and fills the array defaults", () => {
    const parsed = postSchema.parse({ slug: "kettle-guide", title: "راهنمای کتری", bodyHtml: "", status: "draft" });
    expect(parsed).toEqual({
      slug: "kettle-guide",
      title: "راهنمای کتری",
      excerpt: "",
      bodyHtml: "",
      tags: [],
      status: "draft",
      relatedProductIds: [],
      // seoFields.robots carries a default now: the services all read `input.robots.trim()`.
      robots: "index, follow",
    });
    for (const status of CONTENT_STATUSES) {
      expect(postSchema.parse({ slug: "a", title: "عنوان", bodyHtml: "", status }).status).toBe(status);
    }
  });

  it("caps the related products, the tags and the html, and keeps the html verbatim", () => {
    const base = { slug: "a", title: "عنوان", bodyHtml: "", status: "published" as const };
    expect(postSchema.parse({ ...base, relatedProductIds: Array.from({ length: 12 }, (_, i) => i + 1) }).relatedProductIds.length).toBe(12);
    expect(() => postSchema.parse({ ...base, relatedProductIds: Array.from({ length: 13 }, (_, i) => i + 1) })).toThrow();
    expect(() => postSchema.parse({ ...base, tags: [""] })).toThrow();
    expect(() => postSchema.parse({ ...base, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).toThrow();
    expect(() => postSchema.parse({ ...base, slug: "a/b" })).toThrow();
    expect(() => postSchema.parse({ ...base, title: "دو" })).toThrow();
    expect(() => postSchema.parse({ ...base, bodyHtml: "x".repeat(200_001) })).toThrow();
    // validation only caps length - sanitizing is the service's job (html/sanitize.ts)
    const dirty = '<script>alert(1)</script><p onclick="x">hi</p>';
    expect(postSchema.parse({ ...base, bodyHtml: dirty }).bodyHtml).toBe(dirty);
    expect(htmlField(10).parse(" <p>ok</p> ")).toBe("<p>ok</p>");
    expect(() => htmlField(3).parse("<p>x</p>")).toThrow();
  });

  it("takes the seo fields and is strict", () => {
    const base = { slug: "a", title: "عنوان", bodyHtml: "", status: "draft" as const };
    for (const robots of ROBOTS_VALUES) {
      expect(postSchema.parse({ ...base, robots }).robots).toBe(robots);
      expect(robotsSchema.parse(robots)).toBe(robots);
    }
    expect(postSchema.parse({ ...base, seoTitle: null, seoDescription: null }).seoTitle).toBe(null);
    expect(() => postSchema.parse({ ...base, robots: "index" })).toThrow();
    expect(() => postSchema.parse({ ...base, seoTitle: "x".repeat(201) })).toThrow();
    expect(() => postSchema.parse({ ...base, seoDescription: "x".repeat(401) })).toThrow();
    expect(() => postSchema.parse({ ...base, coverMediaId: "1" })).toThrow();
    expect(postSchema.parse({ ...base, coverMediaId: ULID }).coverMediaId).toBe(ULID);
    expect(() => postSchema.parse({ ...base, viewCount: 10 })).toThrow();
    expect(() => postSchema.parse({ ...base, publishedAt: "2026-08-25" })).toThrow();
  });

  it("keeps the robots strings the WordPress import stored, and still refuses anything else", () => {
    const base = { slug: "a", title: "عنوان", bodyHtml: "", status: "published" as const };
    for (const robots of [
      "follow, index, max-snippet:-1, max-video-preview:-1, max-image-preview:large",
      "noindex, nofollow, max-snippet:-1, max-video-preview:-1, max-image-preview:large",
    ]) {
      expect(robotsSchema.parse(robots)).toBe(robots);
      expect(postSchema.parse({ ...base, robots }).robots).toBe(robots);
    }
    for (const bad of ["", "follow", "follow, max-image-preview:large", "index, noindex, follow", "index, follow, index", "index, follow, noarchive", "index, follow, max-image-preview:huge", "index, follow; max-snippet:-1"]) {
      expect(() => robotsSchema.parse(bad), bad).toThrow();
    }
  });
});

describe("page template enum", () => {
  it("takes only the decided templates", () => {
    for (const template of PAGE_TEMPLATES) {
      expect(pageSchema.parse({ slug: "about", title: "دربارهٔ ما", bodyHtml: "", template, status: "published" }).template).toBe(template);
    }
    for (const bad of ["blog", "", "Default", null]) {
      expect(
        () => pageSchema.parse({ slug: "about", title: "دربارهٔ ما", bodyHtml: "", template: bad, status: "published" }),
        JSON.stringify(bad),
      ).toThrow();
    }
    expect(() => pageSchema.parse({ slug: "about", title: "د", bodyHtml: "", template: "default", status: "draft" })).toThrow();
    expect(() => pageSchema.parse({ slug: "about", bodyHtml: "", template: "default", status: "draft" })).toThrow();
    expect(() => pageSchema.parse({ slug: "about", title: "دربارهٔ ما", bodyHtml: "", template: "default", status: "draft", excerpt: "x" })).toThrow();
  });
});

describe("faq", () => {
  it("groups by a latin key and defaults isActive to true", () => {
    expect(faqSchema.parse({ groupKey: "shipping", question: "چند روزه می‌رسد؟", answerHtml: "<p>۱ تا ۷ روز</p>", sort: 0 })).toEqual({
      groupKey: "shipping",
      question: "چند روزه می‌رسد؟",
      answerHtml: "<p>۱ تا ۷ روز</p>",
      sort: 0,
      isActive: true,
    });
    expect(faqSchema.parse({ groupKey: "a", question: "سؤال", answerHtml: "", sort: "۳" }).sort).toBe(3);
    expect(() => faqSchema.parse({ groupKey: "Shipping", question: "سؤال", answerHtml: "", sort: 0 })).toThrow();
    expect(() => faqSchema.parse({ groupKey: "shipping", question: "سؤ", answerHtml: "", sort: 0 })).toThrow();
    expect(() => faqSchema.parse({ groupKey: "shipping", question: "سؤال", answerHtml: "x".repeat(20_001), sort: 0 })).toThrow();
    expect(() => faqSchema.parse({ groupKey: "shipping", question: "سؤال", answerHtml: "", sort: -1 })).toThrow();
  });
});

describe("menu recursion and kind rules", () => {
  const url = (label: string, children?: MenuItemInput[]): MenuItemInput => ({
    label,
    kind: "url",
    href: "/shop/",
    ...(children ? { children } : {}),
  });

  it("requires href for kind url and ref for every other kind", () => {
    expect(menuItemSchema.parse(url("فروشگاه"))).toMatchObject({ label: "فروشگاه", kind: "url", href: "/shop/" });
    expect(menuItemSchema.parse({ label: "اسمگ", kind: "brand", ref: "smeg" })).toMatchObject({ ref: "smeg" });

    const noRef = menuItemSchema.safeParse({ label: "اسمگ", kind: "brand" });
    expect(noRef.success).toBe(false);
    expect(noRef.error?.issues[0]?.path).toEqual(["ref"]);
    const noHref = menuItemSchema.safeParse({ label: "فروشگاه", kind: "url" });
    expect(noHref.error?.issues[0]?.path).toEqual(["href"]);
    expect(() => menuItemSchema.parse({ label: "x", kind: "url", href: "javascript:alert(1)" })).toThrow();
    expect(() => menuItemSchema.parse({ label: "x", kind: "url", href: "//evil.com/" })).toThrow();
    expect(() => menuItemSchema.parse({ label: "", kind: "url", href: "/shop/" })).toThrow();
    expect(() => menuItemSchema.parse({ label: "x".repeat(61), kind: "url", href: "/shop/" })).toThrow();
    expect(() => menuItemSchema.parse({ label: "x", kind: "collection", ref: "gifts", target: "_blank" })).toThrow();
  });

  it("allows three levels and refuses a fourth", () => {
    expect(menuItemSchema.parse(url("a", [url("b", [url("c")])]))).toBeTruthy();
    expect(() => menuItemSchema.parse(url("a", [url("b", [url("c", [url("d")])])]))).toThrow();
  });

  it("caps the children and the top-level items at thirty", () => {
    const many = Array.from({ length: MENU_MAX_CHILDREN }, (_, i) => url(`i${i}`));
    expect(menuItemSchema.parse(url("a", many))).toBeTruthy();
    expect(() => menuItemSchema.parse(url("a", [...many, url("extra")]))).toThrow();
    for (const key of MENU_KEYS) {
      expect(menuSchema.parse({ key, items: [url("فروشگاه")] }).key).toBe(key);
    }
    expect(menuSchema.parse({ key: "header", items: [] }).items).toEqual([]);
    expect(() => menuSchema.parse({ key: "header", items: [...many, url("extra")] })).toThrow();
    expect(() => menuSchema.parse({ key: "sidebar", items: [] })).toThrow();
    expect(() => menuSchema.parse({ key: "header", items: [], version: 2 })).toThrow();
  });
});

describe("redirect path rules", () => {
  it("takes two decoded paths with a trailing slash and code 301 or 410", () => {
    expect(redirectSchema.parse({ fromPath: "/old/", toPath: "/new/", code: 301 })).toEqual({
      fromPath: "/old/",
      toPath: "/new/",
      code: 301,
      isActive: true,
    });
    expect(redirectSchema.parse({ fromPath: "/gone/", toPath: "/", code: 410, isActive: false }).code).toBe(410);
    const same = redirectSchema.safeParse({ fromPath: "/a/", toPath: "/a/", code: 301 });
    expect(same.success).toBe(false);
    expect(same.error?.issues[0]?.path).toEqual(["toPath"]);
    for (const bad of [302, 200, "301", 0]) {
      expect(() => redirectSchema.parse({ fromPath: "/a/", toPath: "/b/", code: bad }), JSON.stringify(bad)).toThrow();
    }
    for (const fromPath of ["/a", "a/", "/a/../b/", "//evil/", "https://evil.com/", ""]) {
      expect(() => redirectSchema.parse({ fromPath, toPath: "/b/", code: 301 }), JSON.stringify(fromPath)).toThrow();
    }
    expect(() => redirectSchema.parse({ fromPath: "/a/", toPath: "/b/", code: 301, note: "x" })).toThrow();
  });
});

describe("seo meta", () => {
  it("targets one of the six entities by numeric id", () => {
    expect(seoMetaSchema.parse({ entity: "product", id: "۱۰۴۴", robots: "index, follow" })).toEqual({
      entity: "product",
      id: 1044,
      robots: "index, follow",
    });
    for (const entity of ["product", "category", "brand", "collection", "post", "page"]) {
      expect(seoMetaSchema.parse({ entity, id: 1 }).entity).toBe(entity);
    }
    expect(() => seoMetaSchema.parse({ entity: "faq", id: 1 })).toThrow();
    expect(() => seoMetaSchema.parse({ entity: "product", id: 1, robots: "index" })).toThrow();
    expect(() => seoMetaSchema.parse({ entity: "product", id: 0 })).toThrow();
    expect(() => seoMetaSchema.parse({ entity: "product", id: 1, canonical: "/x/" })).toThrow();

    expect(slugParamSchema.parse({ slug: "کتری-برقی" })).toEqual({ slug: "کتری-برقی" });
    expect(() => slugParamSchema.parse({ slug: "a/b" })).toThrow();
    expect(() => slugParamSchema.parse({ slug: "a", page: 2 })).toThrow();
  });
});
