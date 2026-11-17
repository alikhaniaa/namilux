import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export const EXTRACT_FILES = {
  inventoryCsv: "01_sitemap/url-inventory-and-redirect-map.csv",
  sitemapCsv: "01_sitemap/sitemap.csv",
  robotsTxt: "01_sitemap/robots.txt",
  seoLiveCsv: "02_seo/seo_live.csv",
  seoLiveJson: "02_seo/seo_live.json",
  postsJson: "03_content/posts.json",
  pagesJson: "03_content/pages.json",
  productsDir: "04_catalog/products",
  productsCommerceJson: "04_catalog/products_commerce.json",
  productsWpJson: "04_catalog/products_wp.json",
  categoriesCsv: "04_catalog/categories.csv",
  taxonomiesStoreJson: "04_catalog/taxonomies_store.json",
  taxonomiesWpJson: "04_catalog/taxonomies_wp.json",
  mediaCsv: "05_media/media.csv",
  mediaLibraryJson: "05_media/media_library.json",
  mediaFilesDir: "05_media/files",
  provincesJson: "06_commerce/iran-provinces-cities.json",
  menusJson: "07_design/menus.json",
  dataQualityMd: "09_reports/data-quality.md",
  curatedCsv: "10_rebuild-brief/namilux-products-categorised.csv",
} as const;

export type ExtractFileKey = keyof typeof EXTRACT_FILES;

export const REQUIRED_FILES: readonly ExtractFileKey[] = [
  "inventoryCsv",
  "sitemapCsv",
  "seoLiveCsv",
  "postsJson",
  "pagesJson",
  "productsDir",
  "productsCommerceJson",
  "productsWpJson",
  "categoriesCsv",
  "taxonomiesStoreJson",
  "mediaCsv",
  "menusJson",
  "curatedCsv",
];

export const OPTIONAL_FILES: readonly ExtractFileKey[] = [
  "robotsTxt",
  "seoLiveJson",
  "taxonomiesWpJson",
  "mediaLibraryJson",
  "mediaFilesDir",
  "provincesJson",
  "dataQualityMd",
];

/** DATA QUIRK: README says `<id>-<slug>`; the checkout has bare `<id>` directories. Accept both. */
export const PRODUCT_DIR_RE = /^(\d+)(?:-.+)?$/;
/** Gallery files are `NN-<original>`; `01-` is the featured image. */
export const PRODUCT_IMAGE_RE = /^(\d{2})-(.+)$/;

export const EXTRACT_META = {
  extractedAt: "2026-08-14T12:55:46.508Z",
  origin: "https://namilux.ir",
} as const;

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

export function resolveExtractDir(override?: string | null, env: NodeJS.ProcessEnv = process.env): string {
  if (override) return path.resolve(override);
  if (env["SEED_EXTRACT_DIR"]) return path.resolve(env["SEED_EXTRACT_DIR"]);
  return path.join(REPO_ROOT, "data", "extract");
}

export function resolveMediaDir(override?: string | null, env: NodeJS.ProcessEnv = process.env): string {
  if (override) return path.resolve(override);
  if (env["MEDIA_DIR"]) return path.resolve(env["MEDIA_DIR"]);
  return path.join(REPO_ROOT, ".media");
}

export function extractPath(dir: string, key: ExtractFileKey): string {
  return path.join(dir, ...EXTRACT_FILES[key].split("/"));
}

export function missingExtractFiles(dir: string): string[] {
  return REQUIRED_FILES.filter((k) => !existsSync(extractPath(dir, k))).map((k) => EXTRACT_FILES[k]);
}

export function productDirs(dir: string): { id: number; dir: string }[] {
  const root = extractPath(dir, "productsDir");
  if (!existsSync(root)) return [];
  const seen = new Set<number>();
  const out: { id: number; dir: string }[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const m = PRODUCT_DIR_RE.exec(entry.name);
    if (!m || m[1] === undefined) continue;
    const id = Number(m[1]);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, dir: path.join(root, entry.name) });
  }
  return out.sort((a, b) => a.id - b.id);
}
