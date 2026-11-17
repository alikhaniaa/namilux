import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { productDirs, extractPath, PRODUCT_IMAGE_RE } from "./paths.js";
// DECISION: the header's dependency list list omits these three, but the contract itself delegates to
// them (`pickBrand` is "the brand resolver used per product" in brands.ts, `curated` comes from
// collections.ts `curatedByProductId`, and the *_gmt parser is posts.ts `isoFromWpGmt`). Importing
// beats re-implementing the same rules twice and drifting.
import { LEGACY_BRAND_META, NEW_BRANDS, resolveBrandSlug, UNIDENTIFIED_BRAND_TOKENS } from "./brands.js";
import { curatedByProductId } from "./collections.js";
import { isoFromWpGmt } from "./posts.js";
import { decodeSlug, productPath } from "../transform/slugs.js";

export type LegacyImageRef = { n: number; file: string; sourceUrl: string; alt: string; exists: boolean };
export type LegacySpecAttr = { label: string; rawValue: string };
export type LegacyCurated = {
  brandEn: string;
  brandFa: string;
  groupEn: string;
  groupFa: string;
  subEn: string;
  subFa: string;
  collection: string | null;
  priceBand: string;
};

export type LegacyProduct = {
  id: number;
  slug: string;
  path: string;
  name: string;
  sku: string | null;
  price: number;
  regularPrice: number;
  salePrice: number;
  onSale: boolean;
  onRequest: boolean;
  inStock: boolean;
  purchasable: boolean;
  lowStockRemaining: number | null;
  onBackorder: boolean;
  stockText: string;
  brand: {
    source: "pa_brand" | "custom" | "commerce_brands" | "curated" | "name" | null;
    slug: string | null;
    nameFa: string | null;
    nameEn: string | null;
  };
  colorNames: string[];
  colorSource: "pa_color" | "custom" | "name" | null;
  categoryIds: number[];
  categorySource: "commerce" | "wp" | null;
  specAttrs: LegacySpecAttr[];
  shortHtml: string;
  descriptionHtml: string;
  hasVideo: boolean;
  dimsMm: { length: number | null; width: number | null; height: number | null } | null;
  weightG: number | null;
  images: LegacyImageRef[];
  featuredMediaId: number | null;
  publishedAt: string | null;
  modifiedAt: string | null;
  curated: LegacyCurated | null;
  ratingAvg: number;
  reviewCount: number;
};

/** Custom-attribute labels that carry brand/colour instead of a spec (DATA QUIRK: 48 / 49 products). */
export const BRAND_ATTR_LABELS: readonly string[] = ["برند", "برند سازنده"];
export const COLOR_ATTR_LABELS: readonly string[] = ["رنگ"];

/** Legacy HTML that embeds a player (the sanitizer drops it; the report counts it). */
const VIDEO_RE = /<video[\s>]|\.mp4\b/i;

type RawTerm = { id?: unknown; name?: unknown; slug?: unknown };
type RawAttribute = { name?: unknown; taxonomy?: unknown; terms?: unknown };
type RawImage = { file?: unknown; url?: unknown; alt?: unknown };
type RawPrices = { price?: unknown; regular_price?: unknown; sale_price?: unknown };
type RawProductJson = {
  id?: unknown;
  slug?: unknown;
  name?: unknown;
  sku?: unknown;
  prices?: RawPrices | null;
  on_sale?: unknown;
  is_in_stock?: unknown;
  is_purchasable?: unknown;
  low_stock_remaining?: unknown;
  stock_availability?: { text?: unknown } | null;
  description_html?: unknown;
  short_description_html?: unknown;
  categories?: unknown;
  attributes?: unknown;
  images?: unknown;
  image_urls?: unknown;
  average_rating?: unknown;
  review_count?: unknown;
};
type RawCommerce = {
  id?: unknown;
  brands?: unknown;
  dimensions?: { length?: unknown; width?: unknown; height?: unknown } | null;
  weight?: unknown;
  low_stock_remaining?: unknown;
  is_on_backorder?: unknown;
};
type RawWp = { id?: unknown; product_cat?: unknown; featured_media?: unknown; date_gmt?: unknown; modified_gmt?: unknown };

function stripControl(s: string): string {
  // \p{Cc} covers C0/C1 + DEL without writing a literal control char into the source.
  return (s ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\p{Cc}\ufeff\ufffd]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Narrow a JSON value to a string without ever stringifying an object. */
function toStr(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function attributes(pj: unknown): RawAttribute[] {
  const attrs = (pj as RawProductJson | null)?.attributes;
  return Array.isArray(attrs) ? (attrs as RawAttribute[]) : [];
}

function termNames(a: RawAttribute | undefined): string[] {
  const terms = a?.terms;
  if (!Array.isArray(terms)) return [];
  return (terms as RawTerm[]).map((t) => stripControl(typeof t?.name === "string" ? t.name : "")).filter(Boolean);
}

function labelMatches(a: RawAttribute, labels: readonly string[]): boolean {
  const name = stripControl(typeof a.name === "string" ? a.name : "");
  return labels.includes(name);
}

export function parseToman(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : 0;
  // currency_minor_unit = 0 - "137000000" is 137,000,000 Toman. NEVER divide.
  const digits = String(v).replace(/[^0-9]/g, "");
  if (!digits) return 0;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}

export function saleFrom(
  prices: { price: string; regular_price: string; sale_price: string },
  onSale: boolean,
): { price: number; compareAt: number | null } {
  const price = parseToman(prices?.price);
  const regular = parseToman(prices?.regular_price);
  const sale = parseToman(prices?.sale_price);
  return { price, compareAt: onSale && sale > 0 && regular > sale ? regular : null };
}

/** WooCommerce stores cm; anything already above 1,000 is assumed to be mm. */
function lengthToMm(v: unknown): number | null {
  const s = toStr(v).trim();
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1000 ? Math.round(n) : Math.round(n * 10);
}

export function parseDimensionsMm(
  d: { length: string; width: string; height: string } | undefined,
): LegacyProduct["dimsMm"] {
  if (!d) return null;
  const length = lengthToMm(d.length);
  const width = lengthToMm(d.width);
  const height = lengthToMm(d.height);
  if (length === null && width === null && height === null) return null;
  return { length, width, height };
}

export function parseWeightG(w: string | undefined): number | null {
  const s = (w ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  // WooCommerce stores kg; anything already above 1,000 is assumed to be grams.
  return n > 1000 ? Math.round(n) : Math.round(n * 1000);
}

function brandNames(slug: string | null, i: { paName: string | null; customBrand: string | null; commerceName: string | null; curated: LegacyCurated | null }): {
  nameFa: string | null;
  nameEn: string | null;
} {
  const unidentified = new Set(UNIDENTIFIED_BRAND_TOKENS);
  const curatedFa = i.curated && !unidentified.has(i.curated.brandFa) ? i.curated.brandFa : "";
  const curatedEn = i.curated && !unidentified.has(i.curated.brandEn) ? i.curated.brandEn : "";
  const newBrand = slug ? NEW_BRANDS.find((b) => b.slug === slug) : undefined;
  const nameFa = newBrand?.nameFa ?? (i.paName || i.customBrand || i.commerceName || curatedFa || null);
  const nameEn = (slug ? LEGACY_BRAND_META[slug]?.en : undefined) ?? newBrand?.nameEn ?? (curatedEn || null);
  return { nameFa: nameFa || null, nameEn: nameEn || null };
}

export function pickBrand(pj: unknown, commerce: unknown, curated: LegacyCurated | null): LegacyProduct["brand"] {
  const attrs = attributes(pj);
  const paAttr = attrs.find((a) => a.taxonomy === "pa_brand");
  const paTerm = (Array.isArray(paAttr?.terms) ? (paAttr.terms as RawTerm[])[0] : undefined) ?? undefined;
  const paSlug = typeof paTerm?.slug === "string" ? paTerm.slug : null;
  const paName = stripControl(typeof paTerm?.name === "string" ? paTerm.name : "") || null;

  const customAttr = attrs.find((a) => !a.taxonomy && labelMatches(a, BRAND_ATTR_LABELS));
  const customBrand = termNames(customAttr)[0] ?? null;

  const commerceBrands = (commerce as RawCommerce | null)?.brands;
  const commerceTerm = Array.isArray(commerceBrands) ? (commerceBrands[0] as RawTerm | undefined) : undefined;
  const commerceSlug = typeof commerceTerm?.slug === "string" ? commerceTerm.slug : null;
  const commerceName = stripControl(typeof commerceTerm?.name === "string" ? commerceTerm.name : "") || null;

  const name = stripControl(typeof (pj as RawProductJson | null)?.name === "string" ? ((pj as RawProductJson).name as string) : "");
  const { slug, source } = resolveBrandSlug({
    paBrandSlug: paSlug,
    customBrand,
    commerceBrand: commerceSlug ?? commerceName,
    curatedBrandEn: curated?.brandEn ?? null,
    name,
  });
  const { nameFa, nameEn } = brandNames(slug, { paName, customBrand, commerceName, curated });
  return { source, slug, nameFa, nameEn };
}

export function pickColors(pj: unknown): { colorNames: string[]; colorSource: LegacyProduct["colorSource"] } {
  const attrs = attributes(pj);
  const paColor = attrs.find((a) => a.taxonomy === "pa_color");
  const paNames = termNames(paColor);
  if (paNames.length) return { colorNames: paNames, colorSource: "pa_color" };

  const customAttr = attrs.find((a) => !a.taxonomy && labelMatches(a, COLOR_ATTR_LABELS));
  if (customAttr) {
    // DATA QUIRK: «سفید-طلایی» is ONE colour - the hyphen is never a separator.
    const parts = termNames(customAttr)
      .join("، ")
      .split(/[،,/]/)
      .map((s) => stripControl(s))
      .filter(Boolean);
    if (parts.length) return { colorNames: parts, colorSource: "custom" };
  }
  return { colorNames: [], colorSource: null };
}

export function pickCategories(
  pj: unknown,
  wp: unknown,
): { categoryIds: number[]; categorySource: LegacyProduct["categorySource"] } {
  const raw = (pj as RawProductJson | null)?.categories;
  const fromStore = Array.isArray(raw)
    ? raw.map((c) => Number((c as { id?: unknown })?.id)).filter((n) => Number.isFinite(n))
    : [];
  if (fromStore.length) return { categoryIds: fromStore, categorySource: "commerce" };
  // DATA QUIRK: 29 products are empty in the Store API but carry `product_cat` in WP REST.
  const wpRaw = (wp as RawWp | null)?.product_cat;
  const fromWp = Array.isArray(wpRaw) ? wpRaw.map((n) => Number(n)).filter((n) => Number.isFinite(n)) : [];
  if (fromWp.length) return { categoryIds: fromWp, categorySource: "wp" };
  return { categoryIds: [], categorySource: null };
}

export function imageRefs(dirAbs: string, pj: unknown): LegacyImageRef[] {
  const p = pj as RawProductJson | null;
  const localRaw = Array.isArray(p?.images) ? (p.images as RawImage[]) : [];
  const locals = localRaw.filter((im) => typeof im?.file === "string" && im.file);
  const byN = new Map<number, RawImage>();
  locals.forEach((im, index) => {
    const base = path.basename(im.file as string);
    const m = PRODUCT_IMAGE_RE.exec(base);
    const n = m?.[1] !== undefined ? Number(m[1]) : index + 1;
    if (Number.isFinite(n) && !byN.has(n)) byN.set(n, im);
  });

  const urls = Array.isArray(p?.image_urls) ? (p.image_urls as unknown[]).map((u) => (typeof u === "string" ? u : "")) : [];
  const out: LegacyImageRef[] = [];
  const push = (n: number, im: RawImage | undefined, sourceUrl: string): void => {
    const file = im && typeof im.file === "string" ? path.resolve(dirAbs, ...im.file.split("/")) : "";
    out.push({
      n,
      file,
      sourceUrl,
      alt: stripControl(typeof im?.alt === "string" ? im.alt : ""),
      // An image the extractor could not fetch (404 upstream) is KEPT with exists:false so the
      // gallery order survives and the report can count it (products 41546 / 48902).
      exists: file ? existsSync(file) : false,
    });
  };

  if (urls.length) {
    urls.forEach((url, index) => push(index + 1, byN.get(index + 1), url));
  } else {
    locals.forEach((im, index) => {
      const base = path.basename(im.file as string);
      const m = PRODUCT_IMAGE_RE.exec(base);
      const n = m?.[1] !== undefined ? Number(m[1]) : index + 1;
      push(Number.isFinite(n) ? n : index + 1, im, typeof im.url === "string" ? im.url : "");
    });
  }
  return out.sort((a, b) => a.n - b.n);
}

async function readJsonList(file: string, key: string): Promise<Map<number, Record<string, unknown>>> {
  const out = new Map<number, Record<string, unknown>>();
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  const rows = (parsed as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(rows)) return out;
  for (const r of rows as Record<string, unknown>[]) {
    const id = Number(r?.["id"]);
    if (Number.isFinite(id)) out.set(id, r);
  }
  return out;
}

export async function readLegacyProducts(
  dir: string,
  opts?: { limit?: number | null; only?: number[] },
): Promise<{ products: LegacyProduct[]; warnings: string[] }> {
  const warnings: string[] = [];
  const [commerce, wp, curated] = await Promise.all([
    readJsonList(extractPath(dir, "productsCommerceJson"), "products"),
    readJsonList(extractPath(dir, "productsWpJson"), "products"),
    curatedByProductId(dir),
  ]);

  const all = productDirs(dir);
  const allow = opts?.only ? new Set(opts.only) : null;
  let selected = allow ? all.filter((d) => allow.has(d.id)) : all;
  if (opts?.limit !== null && opts?.limit !== undefined) selected = selected.slice(0, Math.max(0, opts.limit));

  const products: LegacyProduct[] = [];
  const seenIds = new Set<number>();

  for (const entry of selected) {
    const file = path.join(entry.dir, "product.json");
    if (!existsSync(file)) {
      warnings.push(`product folder ${entry.id} has no product.json — skipped`);
      continue;
    }
    let pj: RawProductJson;
    try {
      pj = JSON.parse(await readFile(file, "utf8")) as RawProductJson;
    } catch (e) {
      warnings.push(`product ${entry.id}: product.json is not valid JSON (${String(e)}) — skipped`);
      continue;
    }
    const id = Number(pj.id) || entry.id;
    seenIds.add(id);

    const com = commerce.get(id) as RawCommerce | undefined;
    const wpRow = wp.get(id) as RawWp | undefined;
    const cur = curated.get(id) ?? null;

    const slug = decodeSlug(typeof pj.slug === "string" ? pj.slug : "");
    const prices: RawPrices = pj.prices ?? {};
    const priceStrings = {
      price: toStr(prices.price),
      regular_price: toStr(prices.regular_price),
      sale_price: toStr(prices.sale_price),
    };
    const onSale = Boolean(pj.on_sale);
    const { price } = saleFrom(priceStrings, onSale);
    const descriptionHtml = typeof pj.description_html === "string" ? pj.description_html : "";
    const shortHtml = typeof pj.short_description_html === "string" ? pj.short_description_html : "";
    const lowStockRaw = com?.low_stock_remaining ?? pj.low_stock_remaining;
    const lowStock = lowStockRaw === null || lowStockRaw === undefined || lowStockRaw === "" ? null : Number(lowStockRaw);
    const sku = stripControl(typeof pj.sku === "string" ? pj.sku : "");
    const { colorNames, colorSource } = pickColors(pj);
    const { categoryIds, categorySource } = pickCategories(pj, wpRow);
    const featured = Number(wpRow?.featured_media);

    products.push({
      id,
      slug,
      path: productPath(slug),
      name: stripControl(typeof pj.name === "string" ? pj.name : ""),
      sku: sku || null,
      price,
      regularPrice: parseToman(priceStrings.regular_price),
      salePrice: parseToman(priceStrings.sale_price),
      onSale,
      // "0" means price-on-request and is preserved (283 products).
      onRequest: price === 0,
      inStock: Boolean(pj.is_in_stock),
      purchasable: Boolean(pj.is_purchasable),
      lowStockRemaining: lowStock !== null && Number.isFinite(lowStock) ? lowStock : null,
      onBackorder: Boolean(com?.is_on_backorder),
      stockText: stripControl(typeof pj.stock_availability?.text === "string" ? pj.stock_availability.text : ""),
      brand: pickBrand(pj, com, cur),
      colorNames,
      colorSource,
      categoryIds,
      categorySource,
      specAttrs: attributes(pj)
        .filter((a) => !a.taxonomy)
        .map((a) => ({
          label: stripControl(typeof a.name === "string" ? a.name : ""),
          rawValue: termNames(a).join("، "),
        }))
        .filter((s) => s.label && s.rawValue),
      shortHtml,
      descriptionHtml,
      hasVideo: VIDEO_RE.test(descriptionHtml) || VIDEO_RE.test(shortHtml),
      dimsMm: parseDimensionsMm(
        com?.dimensions
          ? {
              length: toStr(com.dimensions.length),
              width: toStr(com.dimensions.width),
              height: toStr(com.dimensions.height),
            }
          : undefined,
      ),
      weightG: parseWeightG(toStr(com?.weight) || undefined),
      images: imageRefs(entry.dir, pj),
      featuredMediaId: Number.isFinite(featured) && featured > 0 ? featured : null,
      publishedAt: isoFromWpGmt(typeof wpRow?.date_gmt === "string" ? wpRow.date_gmt : null),
      modifiedAt: isoFromWpGmt(typeof wpRow?.modified_gmt === "string" ? wpRow.modified_gmt : null),
      curated: cur,
      ratingAvg: Number(pj.average_rating) || 0,
      reviewCount: Number(pj.review_count) || 0,
    });
  }

  // Guard (never fires on the 14 Aug extract): rows that exist upstream but have no folder.
  if (!allow && (opts?.limit === null || opts?.limit === undefined)) {
    for (const id of commerce.keys()) {
      if (!seenIds.has(id)) warnings.push(`products_commerce.json id ${id} has no product folder`);
    }
    for (const id of wp.keys()) {
      if (!seenIds.has(id)) warnings.push(`products_wp.json id ${id} has no product folder`);
    }
  }

  return { products, warnings };
}
