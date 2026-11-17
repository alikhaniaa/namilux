import { describe, expect, it } from "vitest";
import { buildMetadata, descriptionFor, noindexMeta, plpMeta, titleFor } from "../metadata";
import type { MetaInput } from "../../types";

const ORIGIN = "https://namilux.ir";
const CTX = { defaultOgKey: "og/default.jpg", mediaUrl: (key: string) => `${ORIGIN}/media/${key}` };

function input(over: Partial<MetaInput> = {}): MetaInput {
  return {
    path: "/shop/",
    title: "فروشگاه",
    description: null,
    robots: "index, follow",
    ogType: "website",
    ogImage: null,
    origin: ORIGIN,
    siteName: "نامی لوکس",
    titleTemplate: "%s - نامی لوکس",
    ...over,
  };
}

describe("metadata", () => {
  it("canonical is lowercase-percent-encoded with a trailing slash", () => {
    const meta = buildMetadata(input({ path: "/product/کتری/" }), CTX);
    expect(meta.alternates.canonical).toBe("https://namilux.ir/product/%da%a9%d8%aa%d8%b1%db%8c/");
    // An already-encoded path must not be encoded a second time.
    const again = buildMetadata(input({ path: "/product/%da%a9%d8%aa%d8%b1%db%8c/" }), CTX);
    expect(again.alternates.canonical).toBe(meta.alternates.canonical);
    // Uppercase hex from a legacy link is normalised, never emitted.
    const upper = buildMetadata(input({ path: "/product/%DA%A9%D8%AA%D8%B1%DB%8C/" }), CTX);
    expect(upper.alternates.canonical).toBe(meta.alternates.canonical);
  });

  it("robots string is emitted verbatim", () => {
    expect(buildMetadata(input({ robots: "noindex, follow" }), CTX).robots).toBe("noindex, follow");
    expect(buildMetadata(input({ robots: "index, follow, max-image-preview:large" }), CTX).robots).toBe(
      "index, follow, max-image-preview:large",
    );
    // Empty falls back rather than emitting an empty directive.
    expect(buildMetadata(input({ robots: "" }), CTX).robots).toBe("index, follow");
  });

  it("noindex pages have index:false follow:true", () => {
    // The private routes of the spec are noindex AND nofollow · nothing on them is worth crawling.
    const meta = noindexMeta("سبد خرید");
    expect(meta.robots).toBe("noindex, nofollow");
    expect(meta.title).toBe("سبد خرید");
    expect(meta.openGraph.images).toEqual([]);

    // A filtered listing is the followable variant.
    expect(plpMeta(input(), { brand: ["smeg"] }).robots).toBe("noindex, follow");
  });

  it("filtered PLP is noindex with the base canonical", () => {
    const filtered = plpMeta(input({ path: "/shop/" }), { brand: ["smeg"], color: ["مشکی"], page: 2 });
    expect(filtered.robots).toBe("noindex, follow");
    // The canonical points at the unfiltered listing, not at the filtered URL.
    expect(buildMetadata(filtered, CTX).alternates.canonical).toBe("https://namilux.ir/shop/");
  });

  it("?page=2 has a self canonical", () => {
    const page2 = plpMeta(input({ path: "/shop/", title: "فروشگاه" }), { page: 2 });
    expect(page2.robots).toBe("index, follow");
    expect(buildMetadata(page2, CTX).alternates.canonical).toBe("https://namilux.ir/shop/?page=2");
    expect(page2.title).toBe("فروشگاه · صفحهٔ ۲");
    // Page 1 is the base URL untouched.
    expect(plpMeta(input(), { page: 1 })).toEqual(input());
  });

  it("og image falls back to the site default", () => {
    const none = buildMetadata(input(), CTX);
    expect(none.openGraph.images).toEqual([{ url: "https://namilux.ir/media/og/default.jpg" }]);
    expect(none.twitter.images).toEqual(["https://namilux.ir/media/og/default.jpg"]);

    const own = buildMetadata(input({ ogImage: "og/p/1044.jpg" }), CTX);
    expect(own.openGraph.images).toEqual([{ url: "https://namilux.ir/media/og/p/1044.jpg" }]);
  });

  it("a missing description stays missing", () => {
    // the spec: 86 legacy pages have none, and nothing is invented before Phase 2.
    const meta = buildMetadata(input({ description: null }), CTX);
    expect(meta.description).toBeUndefined();
    expect(meta.openGraph.description).toBeUndefined();
    expect(descriptionFor({ seoDescription: null, text: "متن کامل بدنه" })).toBeUndefined();
    expect(descriptionFor({ seoDescription: "توضیح واقعی" })).toBe("توضیح واقعی");
  });

  it("titleFor uses the stored title verbatim, else the template", () => {
    expect(titleFor({ seoTitle: "کتری برقی اسمگ KLF03 | نامی لوکس", name: "کتری" }, "%s - نامی لوکس")).toBe(
      "کتری برقی اسمگ KLF03 | نامی لوکس",
    );
    expect(titleFor({ seoTitle: null, name: "کتری" }, "%s - نامی لوکس")).toBe("کتری - نامی لوکس");
    expect(titleFor({ seoTitle: "", name: "کتری" }, "%s - نامی لوکس")).toBe("کتری - نامی لوکس");
    // Over-long legacy titles are emitted as they are: parity first.
    const long = "ا".repeat(120);
    expect(titleFor({ seoTitle: long, name: "x" }, "%s")).toBe(long);
  });

  it("openGraph carries the fa_IR locale, the type and the article dates", () => {
    const post = buildMetadata(
      input({ ogType: "article", publishedAt: "2024-05-01T00:00:00.000Z", modifiedAt: "2025-01-02T00:00:00.000Z" }),
      CTX,
    );
    expect(post.openGraph.locale).toBe("fa_IR");
    expect(post.openGraph.type).toBe("article");
    expect(post.openGraph.publishedTime).toBe("2024-05-01T00:00:00.000Z");
    expect(post.openGraph.modifiedTime).toBe("2025-01-02T00:00:00.000Z");
    expect(post.twitter.card).toBe("summary_large_image");
    // A PDP publishes as og:type=product, the way the legacy crawl did.
    expect(buildMetadata(input({ ogType: "product" }), CTX).openGraph.type).toBe("product");
  });
});
