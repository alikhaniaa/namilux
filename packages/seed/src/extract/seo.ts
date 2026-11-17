import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";
import { extractPath } from "./paths.js";
import { toPath } from "../transform/slugs.js";

export type SeoRow = {
  path: string;
  type: "product" | "post" | "product_cat" | "page" | "brand";
  status: number;
  redirected: boolean;
  finalPath: string;
  title: string;
  description: string;
  canonical: string;
  robots: string;
  h1: string;
  ogImage: string;
  schemaTypes: string[];
  wordCount: number;
};

export type LastmodRow = { path: string; lastmod: string | null; sitemapFile: string };

export type SeoFields = {
  seoTitle: string | null;
  seoDescription: string | null;
  robots: string;
  legacyLastmod: string | null;
  inSitemap: boolean;
};

export const ROBOTS_DEFAULT = "index, follow";

export const STATIC_SEO_ROUTES: readonly string[] = [
  "/",
  "/shop/",
  "/blog/",
  "/discount/",
  "/cart/",
  "/compare/",
  "/billing/",
  "/my-account/",
  "/about-us/",
  "/contact-us/",
];

/** `schema_types` is a " | "-joined list in seo_live.csv. */
const SCHEMA_SEPARATOR = " | ";

const SEO_TYPES: readonly SeoRow["type"][] = ["product", "post", "product_cat", "page", "brand"];

type CsvRecord = Record<string, string | undefined>;

async function readCsv(file: string): Promise<CsvRecord[]> {
  const buf = await readFile(file);
  return parse(buf, { columns: true, bom: true, relax_column_count: true });
}

function seoType(raw: string | undefined): SeoRow["type"] {
  const v = (raw ?? "").trim() as SeoRow["type"];
  // DECISION: an unknown `type` falls back to "page" rather than throwing - the column is
  // descriptive only; importers key on the path, never on this field.
  return SEO_TYPES.includes(v) ? v : "page";
}

export async function readSeoLive(dir: string): Promise<Map<string, SeoRow>> {
  const rows = await readCsv(extractPath(dir, "seoLiveCsv"));
  const out = new Map<string, SeoRow>();
  for (const r of rows) {
    const url = r["url"] ?? "";
    if (!url.trim()) continue;
    const path = toPath(url);
    const schema = r["schema_types"] ?? "";
    // Strings are copied VERBATIM (the spec parity): no trim, no ZWNJ, no title-suffix surgery.
    out.set(path, {
      path,
      type: seoType(r["type"]),
      status: Number(r["status"]) || 0,
      redirected: (r["redirected"] ?? "").trim().toLowerCase() === "true",
      finalPath: (r["final_url"] ?? "").trim() ? toPath(r["final_url"] as string) : "",
      title: r["title"] ?? "",
      description: r["meta_description"] ?? "",
      canonical: r["canonical"] ?? "",
      robots: r["robots"] ?? "",
      h1: r["h1"] ?? "",
      ogImage: r["og_image"] ?? "",
      schemaTypes: schema.trim() ? schema.split(SCHEMA_SEPARATOR).map((s) => s.trim()).filter(Boolean) : [],
      wordCount: Number(r["word_count"]) || 0,
    });
  }
  return out;
}

export async function readSitemap(dir: string): Promise<Map<string, LastmodRow>> {
  const rows = await readCsv(extractPath(dir, "sitemapCsv"));
  const out = new Map<string, LastmodRow>();
  for (const r of rows) {
    const url = r["url"] ?? "";
    if (!url.trim()) continue;
    const path = toPath(url);
    out.set(path, {
      path,
      lastmod: (r["lastmod"] ?? "").trim() || null,
      sitemapFile: (r["sitemap_file"] ?? "").trim(),
    });
  }
  return out;
}

export function seoFieldsFor(
  path: string,
  seo: Map<string, SeoRow>,
  lastmod: Map<string, LastmodRow>,
  opts?: { ignoreIfStatus?: number[] },
): SeoFields {
  const ignore = opts?.ignoreIfStatus ?? [404];
  const sitemapRow = lastmod.get(path);
  const legacyLastmod = sitemapRow?.lastmod ?? null;
  const inSitemap = lastmod.has(path);
  const row = seo.get(path);
  if (!row || ignore.includes(row.status)) {
    // The 5 brand 404s carry the 404 template's head - never copied onto an entity.
    return { seoTitle: null, seoDescription: null, robots: ROBOTS_DEFAULT, legacyLastmod, inSitemap };
  }
  return {
    seoTitle: row.title || null,
    seoDescription: row.description || null,
    robots: row.robots || ROBOTS_DEFAULT,
    legacyLastmod,
    inSitemap,
  };
}

export function staticRouteSeo(
  seo: Map<string, SeoRow>,
  lastmod: Map<string, LastmodRow>,
): Record<string, { title: string; description: string; robots: string; lastmod: string | null }> {
  const out: Record<string, { title: string; description: string; robots: string; lastmod: string | null }> = {};
  for (const route of STATIC_SEO_ROUTES) {
    if (!seo.has(route)) continue;
    const f = seoFieldsFor(route, seo, lastmod);
    out[route] = {
      title: f.seoTitle ?? "",
      description: f.seoDescription ?? "",
      robots: f.robots,
      lastmod: f.legacyLastmod,
    };
  }
  return out;
}

export function snapshotRows(
  seo: Map<string, SeoRow>,
  crawledAt: string,
): { path: string; title: string; description: string; canonical: string; robots: string; schemaTypes: string[]; crawledAt: string }[] {
  // Every crawled row, including the 404s: this is the parity baseline, not entity data.
  return [...seo.values()].map((r) => ({
    path: r.path,
    title: r.title,
    description: r.description,
    canonical: r.canonical,
    robots: r.robots,
    schemaTypes: r.schemaTypes,
    crawledAt,
  }));
}
