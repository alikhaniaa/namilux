import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DIFF_COLUMNS,
  SEO_COLUMNS,
  SEO_LIVE_CSV,
  diffRows,
  formatDiff,
  loadAllow,
  normalizeCell,
  parseHead,
  pathOf,
  readSeoCsv,
  schemaTypesOf,
  toCsv,
  toSeoRow,
} from "../parity-crawl";
import type { SeoRow } from "../parity-crawl";
import { repoRoot } from "../check-contract";

const baselineFile = path.join(repoRoot(), SEO_LIVE_CSV);
const baseline = readSeoCsv(baselineFile);

const HTML = `<!doctype html><html lang="fa-IR" dir="rtl"><head>
<title>کتری برقی اسمگ | نامی لوکس</title>
<meta name="description" content="توضیح کوتاه">
<link rel="canonical" href="https://namilux.ir/product/%da%a9%d8%aa%d8%b1%db%8c/">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:title" content="کتری برقی اسمگ">
<meta property="og:image" content="https://namilux.ir/media/a.avif">
<meta property="og:locale" content="fa_IR">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
{"@type":["Organization","HomeGoodsStore"],"name":"n"},
{"@type":"WebSite"},
{"@type":"BreadcrumbList"},
{"@type":"ItemPage","primaryImageOfPage":{"@type":"ImageObject"}},
{"@type":"Product"}]}</script>
</head><body>
<h1>کتری برقی اسمگ &amp; دوستان</h1><h2>a</h2><h2>b</h2>
<img src="/media/a.avif" alt="ok"><img src="/media/b.avif"><img src="/media/c.avif" alt="">
<a href="/shop/">shop</a><a href="https://instagram.com/x">ig</a><a href="#top">top</a>
<script>var noise = "word word word";</script>
</body></html>`;

describe("csv shape", () => {
  it("SEO_COLUMNS match the seo_live.csv header exactly", () => {
    const header = readFileSync(baselineFile, "utf8").split(/\r?\n/)[0] ?? "";
    expect(header.replace(/^\ufeff/, "").split(",")).toEqual([...SEO_COLUMNS]);
  });

  it("readSeoCsv reads all 752 baseline rows", () => {
    expect(baseline).toHaveLength(752);
    expect(baseline[0]?.["url"]?.startsWith("https://namilux.ir/")).toBe(true);
  });

  it("toCsv round-trips through readSeoCsv (BOM, CRLF, quoting)", () => {
    const rows: SeoRow[] = [
      { url: "https://namilux.ir/a/", title: 'a "quoted", comma', h1: "خط\nدوم", status: "200" },
      { url: "https://namilux.ir/b/", title: "", h1: "", status: "404" },
    ];
    const csv = toCsv(rows);
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain("\r\n");
    const dir = mkdtempSync(path.join(tmpdir(), "namilux-parity-"));
    const file = path.join(dir, "seo_crawl.csv");
    writeFileSync(file, csv, "utf8");
    const back = readSeoCsv(file);
    expect(back).toHaveLength(2);
    expect(Object.keys(back[0] ?? {})).toEqual([...SEO_COLUMNS]);
    expect(back[0]?.["title"]).toBe('a "quoted", comma');
    expect(back[0]?.["h1"]).toBe("خط\nدوم");
  });
});

describe("pathOf", () => {
  it("strips the origin and keeps the encoding", () => {
    expect(pathOf("https://namilux.ir/product/%da%a9/")).toBe("/product/%da%a9/");
    expect(pathOf("http://localhost:3000/product/%da%a9/")).toBe("/product/%da%a9/");
    expect(pathOf("https://namilux.ir/shop")).toBe("/shop/");
    expect(pathOf("https://namilux.ir")).toBe("/");
    expect(pathOf("/locations.kml")).toBe("/locations.kml");
    expect(pathOf("/shop/?page=2")).toBe("/shop/");
  });
});

describe("parseHead", () => {
  it("reads title/description/canonical/robots/h1/og/twitter/lang", () => {
    const h = parseHead(HTML, "https://namilux.ir/product/%da%a9%d8%aa%d8%b1%db%8c/");
    expect(h.title).toBe("کتری برقی اسمگ | نامی لوکس");
    expect(h.description).toBe("توضیح کوتاه");
    expect(h.canonical).toBe("https://namilux.ir/product/%da%a9%d8%aa%d8%b1%db%8c/");
    expect(h.robots).toBe("index, follow, max-image-preview:large");
    expect(h.h1).toBe("کتری برقی اسمگ & دوستان");
    expect(h.h1Count).toBe(1);
    expect(h.h2Count).toBe(2);
    expect(h.og.title).toBe("کتری برقی اسمگ");
    expect(h.og.image).toBe("https://namilux.ir/media/a.avif");
    expect(h.og.locale).toBe("fa_IR");
    expect(h.twitter.card).toBe("summary_large_image");
    expect(h.lang).toBe("fa-IR");
    expect(h.imgCount).toBe(3);
    expect(h.imgMissingAlt).toBe(2);
    expect(h.internalLinks).toBe(1);
    expect(h.externalLinks).toBe(1);
    expect(h.wordCount).toBeGreaterThan(0);
  });

  it("schemaTypesOf flattens @graph, arrays and nested @type", () => {
    expect(schemaTypesOf(HTML)).toEqual([
      "Organization",
      "HomeGoodsStore",
      "WebSite",
      "BreadcrumbList",
      "ItemPage",
      "ImageObject",
      "Product",
    ]);
  });

  it("a malformed JSON-LD block contributes nothing instead of throwing", () => {
    expect(schemaTypesOf('<script type="application/ld+json">{ nope </script>')).toEqual([]);
  });

  it("toSeoRow writes every column of seo_live.csv", () => {
    const r = toSeoRow({
      url: "https://namilux.ir/x/",
      type: "product",
      status: 200,
      redirected: false,
      finalUrl: "https://namilux.ir/x/",
      bytes: 2048,
      head: parseHead(HTML, "https://namilux.ir/x/"),
    });
    for (const c of SEO_COLUMNS) expect(r[c]).toBeTypeOf("string");
    expect(r["status"]).toBe("200");
    expect(r["redirected"]).toBe("False");
    expect(r["html_kb"]).toBe("2");
    expect(r["canonical_self"]).toBe("False"); // canonical points at /product/…/, not /x/
    expect(r["schema_types"]).toContain("Product");
  });
});

describe("normalizeCell", () => {
  it("compares canonical as a path, schema_types as a set, status as a number", () => {
    expect(normalizeCell("canonical", "https://namilux.ir/product/%da%a9/")).toBe(
      normalizeCell("canonical", "http://localhost:3000/product/%da%a9/"),
    );
    expect(normalizeCell("canonical", "https://namilux.ir/product/کتری/")).toBe("/product/کتری/");
    expect(normalizeCell("schema_types", "A | B")).toBe(normalizeCell("schema_types", "B | A"));
    expect(normalizeCell("status", "200")).toBe("200");
    expect(normalizeCell("title", "  a\u00a0 b \n")).toBe("a b");
  });
});

describe("diffRows", () => {
  it("identical rows produce zero mismatches (the real 752-row baseline against itself)", () => {
    const diff = diffRows(baseline, baseline, {});
    expect(diff.total).toBe(752);
    expect(diff.compared).toBe(752);
    expect(diff.mismatches).toHaveLength(0);
    expect(diff.explained).toHaveLength(0);
    expect(diff.missingFromCrawl).toHaveLength(0);
    expect(diff.extraInCrawl).toHaveLength(0);
    expect(formatDiff(diff)).toContain("PARITY OK");
  });

  it("flags status, title, canonical, schema_types and h1", () => {
    const live: SeoRow[] = [
      {
        url: "https://namilux.ir/a/",
        status: "200",
        title: "T",
        canonical: "https://namilux.ir/a/",
        schema_types: "WebSite | Product",
        h1: "H",
      },
    ];
    const crawl: SeoRow[] = [
      {
        url: "https://namilux.ir/a/",
        status: "404",
        title: "T2",
        canonical: "https://namilux.ir/b/",
        schema_types: "WebSite",
        h1: "H2",
      },
    ];
    const diff = diffRows(live, crawl, {});
    expect(diff.mismatches.map((c) => c.column).sort()).toEqual([...DIFF_COLUMNS].sort());
    for (const c of DIFF_COLUMNS) expect(diff.byColumn[c]).toBe(1);
    expect(formatDiff(diff)).toContain("PARITY FAILED");
  });

  it("the allow-list explains by column and by column+path", () => {
    const live: SeoRow[] = [
      { url: "https://namilux.ir/a/", title: "T", h1: "H" },
      { url: "https://namilux.ir/b/", title: "T", h1: "H" },
    ];
    const crawl: SeoRow[] = [
      { url: "https://namilux.ir/a/", title: "T2", h1: "H2" },
      { url: "https://namilux.ir/b/", title: "T", h1: "H2" },
    ];
    const diff = diffRows(live, crawl, { h1: "one h1 per page", "title /a/": "rewritten on purpose" });
    expect(diff.mismatches).toHaveLength(0);
    expect(diff.explained).toHaveLength(3);
    expect(diff.explained.map((c) => c.explained)).toContain("rewritten on purpose");
  });

  it("legacy 404 rows are auto-explained when the new site serves 200", () => {
    const live: SeoRow[] = [{ url: "https://namilux.ir/brand/sage/", status: "404" }];
    const crawl: SeoRow[] = [{ url: "https://namilux.ir/brand/sage/", status: "200" }];
    const legacy = new Map<string, number>([["/brand/sage/", 404]]);
    expect(diffRows(live, crawl, {}, legacy).mismatches).toHaveLength(0);
    expect(diffRows(live, crawl, {}, legacy).explained[0]?.explained).toContain("fixed on purpose");
    // without the legacy status map the same diff is unexplained
    expect(diffRows(live, crawl, {}).mismatches).toHaveLength(1);
  });

  it("missing and extra rows fail the run", () => {
    const live: SeoRow[] = [{ url: "https://namilux.ir/a/", title: "T" }];
    const crawl: SeoRow[] = [{ url: "https://namilux.ir/b/", title: "T" }];
    const diff = diffRows(live, crawl, {});
    expect(diff.missingFromCrawl).toEqual(["/a/"]);
    expect(diff.extraInCrawl).toEqual(["/b/"]);
    const out = formatDiff(diff);
    expect(out).toContain("not crawled — 1");
    expect(out).toContain("crawled but not in the baseline — 1");
    expect(out).toContain("PARITY FAILED");
  });

  it("formatDiff caps the listing unless --all", () => {
    const live: SeoRow[] = Array.from({ length: 30 }, (_, i) => ({
      url: `https://namilux.ir/p${i}/`,
      title: "T",
    }));
    const crawl: SeoRow[] = live.map((r) => ({ ...r, title: "X" }));
    const diff = diffRows(live, crawl, {});
    expect(formatDiff(diff, { limit: 5 })).toContain("… and 25 more (run with --all)");
    expect(formatDiff(diff, { all: true })).not.toContain("more (run with --all)");
  });
});

describe("loadAllow", () => {
  it("reads the repo allow-list and ignores non-string entries", () => {
    const allow = loadAllow();
    expect(allow["og:image"]).toContain("og:image");
    expect(allow["h1"]).toBeTypeOf("string");
    expect(loadAllow(path.join(tmpdir(), "namilux-does-not-exist.json"))).toEqual({});
  });
});
