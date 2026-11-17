import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MEDIA_SRC_PREFIX, SANITIZE_OPTIONS, SANITIZE_OPTIONS_NO_IMAGES, isSanitized, sanitizeHtml } from "../sanitize";

const s = (html: string, allowImages?: boolean): string => (allowImages === undefined ? sanitizeHtml(html) : sanitizeHtml(html, { allowImages }));

describe("whitelist tags", () => {
  const kept: [string, string][] = [
    ["<p>سلام</p>", "<p>سلام</p>"],
    ["<h2>دو</h2><h3>سه</h3><h4>چهار</h4>", "<h2>دو</h2><h3>سه</h3><h4>چهار</h4>"],
    ["<ul><li>یک</li></ul>", "<ul><li>یک</li></ul>"],
    ["<ol><li>یک</li></ol>", "<ol><li>یک</li></ol>"],
    ["<p><strong>پررنگ</strong><em>کج</em></p>", "<p><strong>پررنگ</strong><em>کج</em></p>"],
    ["<blockquote><p>نقل</p></blockquote>", "<blockquote><p>نقل</p></blockquote>"],
    ["<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>", "<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>"],
    ["<p>a<br>b<hr></p>", "<p>a<br />b</p><hr />"],
    ["<UL><LI>A</LI></UL>", "<ul><li>A</li></ul>"],
  ];

  for (const [input, want] of kept) {
    it(`keeps ${input}`, () => {
      expect(s(input)).toBe(want);
    });
  }

  it("keeps figure/figcaption around a /media/ image", () => {
    expect(s('<figure><img src="/media/a.jpg"><figcaption>عنوان</figcaption></figure>')).toBe(
      '<figure><img src="/media/a.jpg" /><figcaption>عنوان</figcaption></figure>',
    );
  });

  it("discards an unknown tag but keeps its text (disallowedTagsMode discard)", () => {
    expect(s("<div><span>متن</span></div>")).toBe("متن");
    expect(s("<section><font color=red><u>x</u></font></section>")).toBe("x");
  });

  it("exports the DECIDED options and the media prefix", () => {
    expect(MEDIA_SRC_PREFIX).toBe("/media/");
    expect(SANITIZE_OPTIONS.allowedTags).toContain("img");
    expect(SANITIZE_OPTIONS_NO_IMAGES.allowedTags).not.toContain("img");
    expect(SANITIZE_OPTIONS_NO_IMAGES.allowedTags).not.toContain("figure");
    expect(SANITIZE_OPTIONS.allowedAttributes).toEqual({ a: ["href"], img: ["src", "alt"] });
  });
});

describe("drops scripts, handlers, styles, classes and every other attribute", () => {
  const dropped: [string, string][] = [
    ["<script>alert(1)</script><p>x</p>", "<p>x</p>"],
    ["<script src=//evil></script>", ""],
    ['<style>p{color:red}</style><p>y</p>', "<p>y</p>"],
    ["<style>@import url(https://evil)</style>", ""],
    ['<p onclick="x()">a</p>', "<p>a</p>"],
    ['<p onmouseover="x()" onfocus="y()">a</p>', "<p>a</p>"],
    ['<p style="color:red" class="c" id="i">a</p>', "<p>a</p>"],
    ['<p title="t" data-x="y" lang="en" dir="rtl">a</p>', "<p>a</p>"],
    ["<table><td onclick=x>a</td></table>", "<table><td>a</td></table>"],
    ['<a href="https://x" onmouseover="alert(1)">x</a>', '<a href="https://x">x</a>'],
    ['<a href="https://x" target="_blank" rel="noopener">x</a>', '<a href="https://x">x</a>'],
    ['<iframe src="https://x"></iframe>', ""],
    ['<iframe srcdoc="<script>alert(1)</script>"></iframe>', ""],
    ["<svg onload=x></svg>", ""],
    ["<svg><script>alert(1)</script></svg>", ""],
    ["<object data=x></object>", ""],
    ["<embed src=x>", ""],
    ["<math><mtext>m</mtext></math>", ""],
    ["<template><p>t</p></template>", ""],
    ["<noscript><p>n</p></noscript>", ""],
    ["<textarea><p>t</p></textarea>", ""],
    ["<form><input value=x><button>go</button></form>", "go"],
    ['<base href="https://evil/">', ""],
    ['<meta http-equiv=refresh content="0;url=https://evil">', ""],
  ];

  for (const [input, want] of dropped) {
    it(`sanitizes ${input}`, () => {
      expect(s(input)).toBe(want);
    });
  }

  it("keeps entity-escaped markup escaped (no double decoding)", () => {
    expect(s("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>")).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
    expect(s("<p>&amp;lt;script&amp;gt;</p>")).toBe("<p>&amp;lt;script&amp;gt;</p>");
    expect(s("<p>a & b < c</p>")).toBe("<p>a &amp; b &lt; c</p>");
  });

  it("never leaks an executable construct for the classic payload list", () => {
    const payloads = [
      "<img src=x onerror=alert(1)>",
      "<svg/onload=alert(1)>",
      '"><script>alert(1)</script>',
      "<body onload=alert(1)>",
      "<details open ontoggle=alert(1)>",
      "<video><source onerror=alert(1)>",
      "<isindex action=javascript:alert(1) type=submit>",
      "<xss id=x onafterscriptexecute=alert(1)><script>1</script>",
    ];
    for (const payload of payloads) {
      const out = s(payload);
      expect(out).not.toMatch(/<script/i);
      expect(out).not.toMatch(/on[a-z]+\s*=/i);
      expect(out).not.toMatch(/javascript:/i);
      expect(out).not.toMatch(/<svg|<iframe|<object|<embed/i);
    }
  });

  it("survives mXSS-style breakout attempts", () => {
    // DECISION: these produce "" with the DECIDED options; the assertion is "nothing executable
    // survives", which is the security property, not the exact byte string.
    const mxss = [
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
      "<svg><style><img src=x onerror=alert(1)></style></svg>",
      '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;/mglyph&gt;&lt;img&Tab;src=1&Tab;onerror=alert(1)&gt;">',
      '<table><td><style><!--</style><img src=x onerror=alert(1)></td></table>',
    ];
    for (const payload of mxss) {
      const once = s(payload);
      expect(once).not.toMatch(/<img|onerror|<script|<style/i);
      expect(s(once)).toBe(once); // still a fixed point
    }
  });
});

describe("href scheme table", () => {
  // DECISION: an <a> whose href is rejected is dropped WITH its text (sanitize-html's
  // exclusiveFilter removes the whole frame). The header's rules sentence "its text is kept"
  // does not hold for the DECIDED options; dropping is the stricter behaviour, so it stands.
  const rows: [string, string][] = [
    ['<a href="https://namilux.ir/shop/">x</a>', '<a href="https://namilux.ir/shop/">x</a>'],
    ['<a href="/shop/">x</a>', '<a href="/shop/">x</a>'],
    ['<a href="mailto:a@b.ir">x</a>', '<a href="mailto:a@b.ir">x</a>'],
    ['<a href="tel:+982155550000">x</a>', '<a href="tel:+982155550000">x</a>'],
    ['<a href="javascript:alert(1)">x</a>', ""],
    ['<a href="JaVaScRiPt:alert(1)">x</a>', ""],
    ['<a href="  javascript:alert(1)">x</a>', ""],
    ['<a href="java&#x09;script:alert(1)">x</a>', ""],
    ['<a href="&#106;avascript:alert(1)">x</a>', ""],
    ['<a href="vbscript:msgbox(1)">x</a>', ""],
    ['<a href="data:text/html,<script>alert(1)</script>">x</a>', ""],
    ['<a href="http://evil">x</a>', ""],
    ['<a href="//evil.com">x</a>', ""],
    ['<a href="">x</a>', ""],
    ["<a><strong>bold</strong></a>", ""],
  ];

  for (const [input, want] of rows) {
    it(`${input} → ${want === "" ? "(dropped)" : want}`, () => {
      expect(s(input)).toBe(want);
    });
  }

  it("keeps a nested /media/ image inside an allowed link", () => {
    expect(s('<a href="https://x"><img src="/media/a.jpg"></a>')).toBe('<a href="https://x"><img src="/media/a.jpg" /></a>');
  });
});

describe("img src must be first-party /media/", () => {
  const rows: [string, string][] = [
    ['<img src="/media/p/1044/1/a8f3.jpg" alt="x">', '<img src="/media/p/1044/1/a8f3.jpg" alt="x" />'],
    ['<img src="/media/x.jpg" onerror="x()" width="1" height="1" srcset="https://evil/x 1x">', '<img src="/media/x.jpg" />'],
    ['<img src="https://cdn/x.jpg">', ""],
    ['<img src="data:image/png;base64,AA">', ""],
    ['<img src="//media/x.jpg">', ""],
    ['<img src="MEDIA/x.jpg">', ""],
    ['<img src="/MEDIA/x.jpg">', ""],
    ['<img src="javascript:alert(1)">', ""],
    ["<img>", ""],
  ];

  for (const [input, want] of rows) {
    it(`${input} → ${want === "" ? "(dropped)" : want}`, () => {
      expect(s(input)).toBe(want);
    });
  }
});

describe("allowImages false", () => {
  it("drops img, figure and figcaption but keeps the caption text", () => {
    expect(s('<img src="/media/x.jpg">', false)).toBe("");
    expect(s('<figure><img src="/media/x.jpg"><figcaption>c</figcaption></figure>', false)).toBe("c");
  });

  it("still keeps the text whitelist", () => {
    expect(s("<p>سلام</p>", false)).toBe("<p>سلام</p>");
  });

  it("defaults to allowImages true", () => {
    expect(s('<img src="/media/x.jpg">')).toBe('<img src="/media/x.jpg" />');
    expect(sanitizeHtml('<img src="/media/x.jpg">', {})).toBe('<img src="/media/x.jpg" />');
  });
});

describe("tag transforms", () => {
  const rows: [string, string][] = [
    ["<h1>عنوان</h1>", "<h2>عنوان</h2>"],
    ["<h5>x</h5>", "<h4>x</h4>"],
    ["<h6>x</h6>", "<h4>x</h4>"],
    ["<b>x</b><i>y</i>", "<strong>x</strong><em>y</em>"],
    ['<h1 class="t" id="t">x</h1>', "<h2>x</h2>"],
  ];

  for (const [input, want] of rows) {
    it(`${input} → ${want}`, () => {
      expect(s(input)).toBe(want);
    });
  }
});

describe("empty blocks removed", () => {
  it("drops empty p / li / headings", () => {
    expect(s("<p></p><p> </p><li></li>")).toBe("");
    expect(s("<p>&nbsp;</p>")).toBe("");
    expect(s("<h2></h2><h3> </h3><h4></h4>")).toBe("");
  });

  it("keeps a paragraph whose only child is an image", () => {
    expect(s('<p><img src="/media/x.jpg"></p>')).toBe('<p><img src="/media/x.jpg" /></p>');
  });
});

describe("malformed and polyglot markup", () => {
  const rows: [string, string][] = [
    ["<p>x</p><!--<script>--><img src=x onerror=alert(1)>", "<p>x</p>"],
    ["<p>unclosed", "<p>unclosed</p>"],
    ["<p><p>nested</p></p>", "<p>nested</p>"],
    ["<p>a<div>b</div>c</p>", "<p>a</p>bc"],
    ["<p>x</p></html><script>alert(1)</script>", "<p>x</p>"],
    ["<p>a</p\n>", "<p>a</p>"],
  ];

  for (const [input, want] of rows) {
    it(`${JSON.stringify(input)} → ${want}`, () => {
      expect(s(input)).toBe(want);
    });
  }

  it("collapses a deeply nested paragraph bomb without throwing", () => {
    expect(s(`${"<p>".repeat(200)}deep${"</p>".repeat(200)}`)).toBe("<p>deep</p>");
  });
});

describe("input guards", () => {
  it("returns '' for null, undefined, non-strings and the empty string", () => {
    expect(sanitizeHtml(null as unknown as string)).toBe("");
    expect(sanitizeHtml(undefined as unknown as string)).toBe("");
    expect(sanitizeHtml(42 as unknown as string)).toBe("");
    expect(sanitizeHtml("")).toBe("");
  });

  it("isSanitized is false for non-strings and true for the empty string", () => {
    expect(isSanitized(null as unknown as string)).toBe(false);
    expect(isSanitized("")).toBe(true);
  });
});

describe("idempotence", () => {
  const samples = [
    "<p>سلام</p>",
    '<figure><img src="/media/a.jpg" /><figcaption>c</figcaption></figure>',
    "<h2>عنوان</h2><ul><li>یک</li><li>دو</li></ul>",
    "<p>a &amp; b &lt; c</p>",
    "<p>a<br />b</p><hr />",
    '<a href="https://namilux.ir/shop/">x</a>',
  ];

  for (const sample of samples) {
    it(`isSanitized(${sample}) is true`, () => {
      expect(isSanitized(sample)).toBe(true);
      expect(s(s(sample))).toBe(s(sample));
    });
  }
});

// The legacy corpus lives outside the package; skip when data/extract is not checked out.
const WP_JSON = fileURLToPath(new URL("../../../../../data/extract/04_catalog/products_wp.json", import.meta.url));

describe.skipIf(!existsSync(WP_JSON))("idempotent on the legacy WordPress descriptions", () => {
  type WpProduct = { id: number; content?: { rendered?: string } };
  const products = (JSON.parse(readFileSync(WP_JSON, "utf8")) as { products: WpProduct[] }).products;
  const withHtml = products.filter((p) => (p.content?.rendered ?? "").trim() !== "");

  it("sanitizes 20 legacy descriptions to a fixed point", () => {
    const sample = withHtml.slice(0, 20);
    expect(sample.length).toBe(20);
    for (const p of sample) {
      const once = sanitizeHtml(p.content?.rendered ?? "");
      expect(isSanitized(once)).toBe(true);
    }
  });

  it("product 1044's description is sanitized, idempotent and free of scripts/handlers", () => {
    const p1044 = products.find((p) => p.id === 1044);
    expect(p1044).toBeDefined();
    const once = sanitizeHtml(p1044?.content?.rendered ?? "");
    expect(isSanitized(once)).toBe(true);
    expect(once).not.toMatch(/<script|<style|<iframe|on[a-z]+\s*=|javascript:/i);
    expect(once).not.toMatch(/\sclass=|\sid=|\sstyle=/i);
    expect(once).not.toMatch(/<h1\b/i);
  });

  it("no legacy description survives with a non-/media/ image or a non-whitelisted attribute", () => {
    for (const p of withHtml) {
      const once = sanitizeHtml(p.content?.rendered ?? "");
      for (const match of once.matchAll(/<img[^>]*src="([^"]*)"/g)) {
        expect(match[1]?.startsWith(MEDIA_SRC_PREFIX)).toBe(true);
      }
      expect(once).not.toMatch(/on[a-z]+=/i);
    }
  });
});
