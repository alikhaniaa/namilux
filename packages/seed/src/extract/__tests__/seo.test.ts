import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { EXTRACT_META, extractPath, resolveExtractDir } from "../paths.js";
import {
  ROBOTS_DEFAULT,
  STATIC_SEO_ROUTES,
  type LastmodRow,
  type SeoRow,
  readSeoLive,
  readSitemap,
  seoFieldsFor,
  snapshotRows,
  staticRouteSeo,
} from "../seo.js";

const dir = resolveExtractDir();
const hasExtract = existsSync(extractPath(dir, "seoLiveCsv"));

function row(partial: Partial<SeoRow> & { path: string }): SeoRow {
  return {
    type: "page",
    status: 200,
    redirected: false,
    finalPath: "",
    title: "",
    description: "",
    canonical: "",
    robots: "",
    h1: "",
    ogImage: "",
    schemaTypes: [],
    wordCount: 0,
    ...partial,
  };
}

describe("seoFieldsFor (pure)", () => {
  it("404 row ignored: the brand 404 template head is never copied onto an entity", () => {
    const seo = new Map<string, SeoRow>([
      ["/brand/sage/", row({ path: "/brand/sage/", status: 404, title: "صفحه پیدا نشد", robots: "noindex, follow" })],
    ]);
    const lastmod = new Map<string, LastmodRow>([
      ["/brand/sage/", { path: "/brand/sage/", lastmod: "2026-01-01T00:00:00+00:00", sitemapFile: "pa_brand-sitemap.xml" }],
    ]);
    const f = seoFieldsFor("/brand/sage/", seo, lastmod);
    expect(f.seoTitle).toBeNull();
    expect(f.seoDescription).toBeNull();
    expect(f.robots).toBe(ROBOTS_DEFAULT);
    expect(f.legacyLastmod).toBe("2026-01-01T00:00:00+00:00");
    expect(f.inSitemap).toBe(true);
  });

  it("empty description → null and robots default when the column is empty", () => {
    const seo = new Map<string, SeoRow>([["/x/", row({ path: "/x/", title: "T", description: "", robots: "" })]]);
    const f = seoFieldsFor("/x/", seo, new Map());
    expect(f.seoTitle).toBe("T");
    expect(f.seoDescription).toBeNull();
    expect(f.robots).toBe(ROBOTS_DEFAULT);
    expect(f.legacyLastmod).toBeNull();
    expect(f.inSitemap).toBe(false);
  });

  it("robots default for a completely missing row", () => {
    const f = seoFieldsFor("/nope/", new Map(), new Map());
    expect(f).toEqual({ seoTitle: null, seoDescription: null, robots: ROBOTS_DEFAULT, legacyLastmod: null, inSitemap: false });
  });

  it("ignoreIfStatus is overridable", () => {
    const seo = new Map<string, SeoRow>([["/x/", row({ path: "/x/", status: 404, title: "T" })]]);
    expect(seoFieldsFor("/x/", seo, new Map(), { ignoreIfStatus: [] }).seoTitle).toBe("T");
  });
});

describe.skipIf(!hasExtract)("real seo_live.csv / sitemap.csv", () => {
  let seo: Map<string, SeoRow>;
  let lastmod: Map<string, LastmodRow>;

  beforeAll(async () => {
    seo = await readSeoLive(dir);
    lastmod = await readSitemap(dir);
  });

  it("snapshot rows count 752 (751 distinct paths - /shop/ is listed twice in the source CSV)", () => {
    // DATA QUIRK: seo_live.csv and sitemap.csv both contain https://namilux.ir/shop/ twice, so a
    // map keyed by decoded path holds 751 entries for 752 crawled rows.
    expect(seo.size).toBe(751);
    expect(lastmod.size).toBe(751);
    const rows = snapshotRows(seo, EXTRACT_META.extractedAt);
    expect(rows).toHaveLength(751);
    expect(rows.every((r) => r.crawledAt === EXTRACT_META.extractedAt)).toBe(true);
  });

  it("verbatim title kept incl. emoji and the site suffix", () => {
    const home = seo.get("/");
    expect(home).toBeDefined();
    expect(home?.title).toContain("✅");
    expect(home?.title.trim()).toBe(home?.title);
    const f = seoFieldsFor("/", seo, lastmod);
    expect(f.seoTitle).toBe(home?.title);
  });

  it("the 2 redirected rows are flagged and the 5 brand 404s contribute nothing", () => {
    const redirected = [...seo.values()].filter((r) => r.redirected).map((r) => r.path);
    expect(redirected.sort()).toEqual(["/category/بلاگ/", "/category/محصولات-اسمگ/"].sort());
    const notFound = [...seo.values()].filter((r) => r.status === 404).map((r) => r.path);
    expect(notFound.sort()).toEqual(
      ["/brand/bambum/", "/brand/breville/", "/brand/como/", "/brand/figaro/", "/brand/sage/"].sort(),
    );
    for (const p of notFound) expect(seoFieldsFor(p, seo, lastmod).seoTitle).toBeNull();
  });

  it("the 15 noindex categories keep their robots verbatim", () => {
    const noindexCategories = [...seo.values()].filter(
      (r) => r.type === "product_cat" && r.robots.includes("noindex"),
    );
    expect(noindexCategories.length).toBe(15);
    for (const c of noindexCategories) {
      expect(seoFieldsFor(c.path, seo, lastmod).robots).toBe(c.robots);
    }
  });

  it("empty description → null for the 86 rows that have none", () => {
    const empties = [...seo.values()].filter((r) => r.description === "");
    expect(empties).toHaveLength(86);
    const sample = empties[0] as SeoRow;
    expect(seoFieldsFor(sample.path, seo, lastmod).seoDescription).toBeNull();
  });

  it("robots default: the one row with empty robots falls back", () => {
    const empty = [...seo.values()].filter((r) => r.robots === "");
    expect(empty).toHaveLength(1);
    expect((empty[0] as SeoRow).path).toBe("/locations.kml");
    expect(seoFieldsFor("/locations.kml", seo, lastmod).robots).toBe(ROBOTS_DEFAULT);
  });

  it("brand path without slash normalised and carries a lastmod", () => {
    for (const slug of ["smeg", "dyson", "sage", "breville", "figaro", "bambum", "como"]) {
      const p = `/brand/${slug}/`;
      expect(lastmod.has(p)).toBe(true);
      expect(lastmod.get(p)?.sitemapFile).toBe("pa_brand-sitemap.xml");
    }
  });

  it("kml key keeps extension (no trailing slash added)", () => {
    expect(seo.has("/locations.kml")).toBe(true);
    expect(lastmod.get("/locations.kml")?.sitemapFile).toBe("local-sitemap.xml");
  });

  it("schema_types split on the pipe separator", () => {
    const post = [...seo.values()].find((r) => r.type === "post" && r.schemaTypes.length > 1);
    expect(post?.schemaTypes).toContain("BlogPosting");
    expect(post?.schemaTypes.some((t) => t.includes("|"))).toBe(false);
  });

  it("every product path present in seo_live is also in a sitemap", () => {
    const products = [...seo.values()].filter((r) => r.type === "product");
    expect(products.length).toBe(540);
    expect(products.every((p) => lastmod.has(p.path))).toBe(true);
  });

  it("staticRouteSeo returns the routes that exist in the crawl", () => {
    const statics = staticRouteSeo(seo, lastmod);
    expect(Object.keys(statics).length).toBeGreaterThan(0);
    for (const key of Object.keys(statics)) expect(STATIC_SEO_ROUTES).toContain(key);
    expect(statics["/"]?.title).toBe(seo.get("/")?.title);
  });
});
