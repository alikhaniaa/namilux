import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { htmlToText } from "@namilux/core";
import { describe, expect, it } from "vitest";

import {
  MAX_WORD_LOSS_RATIO,
  collectImageUrls,
  preClean,
  sanitizeLegacyHtml,
  stripTags,
  type ContentImageResolver,
} from "../transform/sanitize.js";

const SITE_ORIGIN = "https://namilux.ir";
const PRODUCT_1044 = fileURLToPath(new URL("../../../../data/extract/04_catalog/products/1044/product.json", import.meta.url));
const hasCorpus = existsSync(PRODUCT_1044);

/** Resolver that behaves like importers/media.ts: known originals map, everything else drops. */
const resolveKnown: ContentImageResolver = (url) =>
  url.includes("known") ? "/media/c/a8f3c1d2e4b5.jpg" : null;
const resolveAll: ContentImageResolver = () => "/media/c/a8f3c1d2e4b5.jpg";
const resolveNone: ContentImageResolver = () => null;

const clean = (html: string, resolveImage: ContentImageResolver = resolveNone) =>
  sanitizeLegacyHtml(html, { resolveImage, siteOrigin: SITE_ORIGIN });

describe("heading demotion", () => {
  it("h1 → h2 and h5/h6 → h4, b/i → strong/em", () => {
    const out = clean("<h1>عنوان</h1><h5>زیر</h5><h6>ریز</h6><b>پررنگ</b><i>کج</i>");
    expect(out.html).toContain("<h2>عنوان</h2>");
    expect(out.html).toContain("<h4>زیر</h4>");
    expect(out.html).toContain("<h4>ریز</h4>");
    expect(out.html).toContain("<strong>پررنگ</strong>");
    expect(out.html).toContain("<em>کج</em>");
    expect(out.html).not.toMatch(/<h1|<h5|<h6|<b>|<i>/);
  });
});

describe("internal link lowercase-hex relative", () => {
  it("rewrites an absolute namilux.ir link to a lowercase-hex site path", () => {
    const out = preClean(
      '<p><a href="https://namilux.ir/product/%DA%A9%D8%AA%D8%B1%DB%8C/?utm=1#x" target="_blank" rel="nofollow">لینک</a></p>',
      { resolveImage: resolveNone, siteOrigin: SITE_ORIGIN },
    );
    expect(out.html).toContain('href="/product/%da%a9%d8%aa%d8%b1%db%8c/"');
    expect(out.html).not.toMatch(/target=|rel=|utm|#x/);
    expect(out.rewrittenLinks).toBe(1);
    expect(out.externalLinks).toBe(0);
  });

  it("keeps the target verbatim (the redirect table does the semantics)", () => {
    const out = preClean('<a href="https://namilux.ir/checkout/">تسویه</a>', {
      resolveImage: resolveNone,
      siteOrigin: SITE_ORIGIN,
    });
    expect(out.html).toContain('href="/checkout/"');
  });

  it("adds the trailing slash a legacy link is missing", () => {
    const out = preClean('<a href="https://namilux.ir/brand/dyson">دایسون</a>', {
      resolveImage: resolveNone,
      siteOrigin: SITE_ORIGIN,
    });
    expect(out.html).toContain('href="/brand/dyson/"');
  });

  it("survives core sanitizeHtml as a same-origin path", () => {
    expect(clean('<p><a href="https://namilux.ir/shop/">فروشگاه</a></p>').html).toContain('href="/shop/"');
  });
});

describe("external link rel", () => {
  it("keeps the href and adds rel=noopener nofollow without a target", () => {
    const out = preClean('<a href="https://example.com/x" target="_blank">بیرونی</a>', {
      resolveImage: resolveNone,
      siteOrigin: SITE_ORIGIN,
    });
    expect(out.html).toContain('<a href="https://example.com/x" rel="noopener nofollow">');
    expect(out.html).not.toContain("target=");
    expect(out.externalLinks).toBe(1);
  });

  it("mailto and tel links are kept as-is", () => {
    const out = clean('<p><a href="mailto:info@namilux.ir">ایمیل</a><a href="tel:+982155550000">تلفن</a></p>');
    expect(out.html).toContain('href="mailto:info@namilux.ir"');
    expect(out.html).toContain('href="tel:+982155550000"');
  });
});

describe("javascript href unwrapped", () => {
  it("keeps the text and drops the anchor for javascript:/data: hrefs", () => {
    const out = clean('<p><a href="javascript:alert(1)">متن</a> و <a href="data:text/html,x">دوم</a></p>');
    expect(out.html).not.toContain("<a");
    expect(out.text).toContain("متن");
    expect(out.text).toContain("دوم");
  });
});

describe("img resolved or removed", () => {
  it("rewrites a processed upload to its /media/ key and keeps the alt", () => {
    const out = clean(
      '<p><img src="https://namilux.ir/wp-content/uploads/2025/07/known-430x430.jpg" alt="کتری" width="430" height="430" loading="lazy" srcset="x 2x"></p>',
      resolveKnown,
    );
    expect(out.html).toContain('src="/media/c/a8f3c1d2e4b5.jpg"');
    expect(out.html).toContain('alt="کتری"');
    expect(out.html).not.toMatch(/width=|height=|srcset=|loading=/);
    expect(out.droppedImages).toBe(0);
  });

  it("removes an unresolved image but keeps the flow", () => {
    const out = clean('<p>قبل <img src="https://namilux.ir/wp-content/uploads/2025/07/missing.jpg"> بعد</p>', resolveNone);
    expect(out.html).not.toContain("<img");
    expect(out.droppedImages).toBe(1);
    expect(out.text).toBe("قبل بعد");
  });

  it("removes a data: URI image", () => {
    const out = clean('<p><img src="data:image/png;base64,AAAA"></p>', resolveAll);
    expect(out.html).not.toContain("<img");
    expect(out.droppedImages).toBe(1);
  });

  it("resolves the images of an Elementor gallery individually and drops the wrappers", () => {
    const out = clean(
      '<div class="col-12"><figure class="woocommerce-product-gallery__wrapper owl-carousel wd-owl">' +
        '<div class="thumb"><img src="https://namilux.ir/wp-content/uploads/known-1.jpg" alt="یک"></div>' +
        '<div class="thumb"><img src="https://namilux.ir/wp-content/uploads/known-2.jpg" alt="دو"></div>' +
        "</figure></div>",
      resolveKnown,
    );
    expect(out.html.match(/<img/g)).toHaveLength(2);
    expect(out.html).not.toMatch(/class=|owl-carousel|<div/);
  });

  it("allowImages:false drops every image", () => {
    const out = sanitizeLegacyHtml('<p><img src="https://namilux.ir/wp-content/uploads/known.jpg" alt="x"></p>', {
      resolveImage: resolveKnown,
      siteOrigin: SITE_ORIGIN,
      allowImages: false,
    });
    expect(out.html).not.toContain("<img");
  });
});

describe("video removed and counted", () => {
  it("removes a wp-video block and counts one dropped video", () => {
    const out = clean(
      '<div class="wp-video"><video class="wp-video-shortcode" controls><source src="https://namilux.ir/x.mp4" type="video/mp4"></video></div><p>متن</p>',
    );
    expect(out.droppedVideos).toBe(1);
    expect(out.html).toBe("<p>متن</p>");
  });

  it("removes iframes and scripts with their content", () => {
    const out = clean('<p>الف</p><iframe src="https://youtube.com/x"></iframe><script>alert(1)</script><style>p{}</style>');
    expect(out.droppedVideos).toBe(1);
    expect(out.html).toBe("<p>الف</p>");
    expect(out.html).not.toMatch(/script|iframe|style/);
  });
});

describe("shortcodes stripped", () => {
  it("removes the [caption] wrapper and keeps the inner text", () => {
    const out = clean('<p>[caption id="attachment_1" align="alignnone" width="300"]شرح تصویر[/caption]</p>');
    expect(out.text).toBe("شرح تصویر");
    expect(out.html).not.toContain("[");
  });
});

describe("empty p removed", () => {
  it("drops whitespace-only, &nbsp;-only and <br>-only blocks", () => {
    const out = clean("<p>&nbsp;</p><p>   </p><p><br></p><li></li><figure> </figure><p>محتوا</p>");
    expect(out.html).toBe("<p>محتوا</p>");
  });

  it("unwraps div/span/font/center and keeps their text", () => {
    const out = clean("<div><span>متن</span> <font>دوم</font></div><center>سوم</center>");
    expect(out.text).toBe("متن دوم سوم");
    expect(out.html).not.toMatch(/<div|<span|<font|<center/);
  });

  it("keeps a table and strips its attributes", () => {
    const raw = '<table style="width:100%" border="1"><tr><td colspan="2" class="c">سلول</td></tr></table>';
    // preClean keeps colspan/rowspan…
    const pre = preClean(raw, { resolveImage: resolveNone, siteOrigin: SITE_ORIGIN });
    expect(pre.html).toContain('colspan="2"');
    expect(pre.html).not.toMatch(/style=|border=|class=/);
    // …and core sanitizeHtml, the authority that runs last, drops every table attribute.
    const out = clean(raw);
    expect(out.html).toContain("<table>");
    expect(out.html).toContain("سلول");
    expect(out.html).not.toMatch(/style=|border=|class=|colspan=/);
  });

  it("applies ZWNJ inside list items", () => {
    const out = clean("<ul><li>ویژگی ها</li><li>سرخ کن های تفال</li></ul>");
    expect(out.html).toContain("<li>ویژگی‌ها</li>");
    expect(out.html).toContain("<li>سرخ‌کن‌های تفال</li>");
  });

  it("never fuses two words across an inline tag (v2 §6.6)", () => {
    expect(clean("<p><strong>الف</strong> ب</p>").text).toBe("الف ب");
  });

  it("keeps numeric entities intact through the digit pass", () => {
    expect(clean("<p>&#1740;&#1705; ۱۳۰۰ وات</p>").text).toBe("یک ۱۳۰۰ وات");
  });
});

describe("no remote src survives", () => {
  it("every img src in the output starts with /media/", () => {
    const out = clean(
      '<p><img src="https://cdn.example.com/x.jpg"><img src="//evil.com/y.jpg"><img src="https://namilux.ir/wp-content/uploads/known.jpg"></p>',
      resolveKnown,
    );
    const srcs = [...out.html.matchAll(/<img[^>]*src="([^"]*)"/g)].map((m) => m[1]);
    expect(srcs).toEqual(["/media/c/a8f3c1d2e4b5.jpg"]);
    expect(out.html).not.toMatch(/https?:|data:/);
  });

  it("a polyglot payload leaves nothing executable", () => {
    const out = clean('<p>x</p><!--<script>--><img src=x onerror=alert(1)><svg onload=alert(1)></svg>', resolveAll);
    expect(out.html).not.toMatch(/onerror|onload|<svg|<script/);
  });
});

describe("word count within 5 %", () => {
  it("keeps the words of a synthetic legacy body", () => {
    const paragraphs = Array.from({ length: 40 }, (_, n) => `<p>پاراگراف شماره ${n} با متن نمونه برای شمارش کلمات</p>`).join("");
    const raw = `<div class="elementor-widget">${paragraphs}</div>`;
    const out = clean(raw);
    const before = htmlToText(raw).split(/\s+/).filter(Boolean).length;
    expect(out.words / before).toBeGreaterThanOrEqual(1 - MAX_WORD_LOSS_RATIO);
  });

  it.skipIf(!hasCorpus)("keeps ≥ 95 % of product 1044's real description", () => {
    const product = JSON.parse(readFileSync(PRODUCT_1044, "utf8")) as { description_html?: string };
    const raw = product.description_html ?? "";
    expect(raw.length).toBeGreaterThan(1000);
    const out = clean(raw, resolveAll);
    // The ZWNJ pass joins «می شود» into one token, so the naive whitespace count drops ~6 % on a
    // Persian body without losing a single word. Content preservation is measured with ZWNJ folded
    // back to a space on both sides.
    const words = (s: string) => s.replace(/‌/g, " ").split(/\s+/).filter(Boolean).length;
    const before = words(htmlToText(raw));
    expect(before).toBeGreaterThan(400);
    expect(words(out.text) / before).toBeGreaterThanOrEqual(1 - MAX_WORD_LOSS_RATIO);
    expect(out.words).toBeGreaterThan(0);
    expect(out.html).not.toMatch(/<div|class=|<script/);
  });
});

describe("collectImageUrls order+dedupe", () => {
  it("returns absolute and /wp-content/ sources in document order, deduped", () => {
    const urls = collectImageUrls(
      '<img src="https://namilux.ir/wp-content/uploads/a.jpg">' +
        "<img src='/wp-content/uploads/b.png'>" +
        '<img src="data:image/png;base64,AAA">' +
        '<img src="https://namilux.ir/wp-content/uploads/a.jpg">' +
        '<img src="/media/c/already.jpg">' +
        "<img src=https://cdn.example.com/c.webp>",
    );
    expect(urls).toEqual([
      "https://namilux.ir/wp-content/uploads/a.jpg",
      "/wp-content/uploads/b.png",
      "https://cdn.example.com/c.webp",
    ]);
    expect(collectImageUrls("")).toEqual([]);
  });
});

describe("stripTags decodes entities", () => {
  it("returns plain text with entities decoded and control chars gone", () => {
    expect(stripTags("<h1>عنوان &amp; شرح</h1>")).toBe("عنوان & شرح");
    expect(stripTags("a&nbsp;b c")).toBe("a bc");
    expect(stripTags("<p>ویژگی&zwnj;ها</p>")).toBe("ویژگی‌ها");
    expect(stripTags("")).toBe("");
  });
});
