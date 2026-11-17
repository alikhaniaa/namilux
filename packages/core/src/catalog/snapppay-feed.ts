import type { ProductDetail } from "../types";
import { absUrl, productUrl } from "../url";
import { MEDIA_PUBLIC_PREFIX, ogSourceKey } from "./media";

/**
 * SnappPay search: the product feed a store serves when it does not run their WooCommerce plugin.
 *
 * Source: academy.snapppay.ir, «افزونه سرچ» (sections «جزئیات فنی API» and «ساخت خوراک محصول») and
 * «شرایط و قوانین فعال‌سازی پذیرنده در اپلیکیشن و جستجو», read on 15 Sep 2026. What it fixes:
 *   - the field names below, verbatim; prices in RIAL; `image_link` an array whose first entry is the
 *     main image; `description` a key → value object of the product's attributes;
 *   - pagination with the `page` and `size` query parameters, and one product by `id` or `slug`;
 *   - nothing may block their collectors (SNAPPPAY_COLLECTOR_IPS).
 * The envelope around the rows (page, size, total, total_pages, products) is ours: their documents
 * leave it open.
 */
export type SnapppayFeedItem = {
  id: string;
  title: string;
  subtitle: string;
  link: string;
  image_link: string[];
  availability: "in stock" | "out of stock";
  regular_price: number;
  sale_price: number;
  category: string;
  brand: string;
  description: Record<string, string>;
  GTIN: string | null;
  color?: string;
};

export type SnapppayFeedPage = {
  page: number;
  size: number;
  total: number;
  total_pages: number;
  products: SnapppayFeedItem[];
};

export const SNAPPPAY_FEED_DEFAULT_SIZE = 100;
export const SNAPPPAY_FEED_MAX_SIZE = 500;

/** The four addresses SnappPay's crawler and feed reader come from; a firewall or CDN must let them through. */
export const SNAPPPAY_COLLECTOR_IPS = ["198.51.100.11", "198.51.100.12", "198.51.100.13", "198.51.100.14"] as const;

/** `page` from 1, `size` 1…SNAPPPAY_FEED_MAX_SIZE; anything missing or malformed falls back rather than failing a crawler. */
export function feedPaging(params: { page?: string | null; size?: string | null }): { page: number; size: number } {
  const int = (raw: string | null | undefined): number | null => {
    if (raw === null || raw === undefined || !/^\d{1,9}$/u.test(raw.trim())) return null;
    return Number(raw.trim());
  };
  const page = Math.max(1, int(params.page) ?? 1);
  const size = Math.min(SNAPPPAY_FEED_MAX_SIZE, Math.max(1, int(params.size) ?? SNAPPPAY_FEED_DEFAULT_SIZE));
  return { page, size };
}

/**
 * One product as SnappPay reads it. `p` is the storefront's own detail, so its price is already the
 * price this storefront sells at (Toman), which the feed states in Rial. The category path is resolved
 * by the caller from the product's primary category («لوازم آشپزخانه > توستر»).
 */
export function toSnapppayFeedItem(p: ProductDetail, ctx: { origin: string; categoryPath: string }): SnapppayFeedItem {
  const seen = new Set<string>();
  const images: string[] = [];
  for (const ref of [p.image, ...p.gallery]) {
    if (ref === undefined) continue;
    const key = ogSourceKey(ref);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    images.push(`${ctx.origin.replace(/\/+$/u, "")}${MEDIA_PUBLIC_PREFIX}${key}`);
  }

  const description: Record<string, string> = {};
  // null-tolerant beyond the types: one malformed spec row must not fail a whole feed page
  const put = (label: string | null | undefined, value: string | null | undefined): void => {
    const k = (label ?? "").trim();
    const v = (value ?? "").trim();
    if (k !== "" && v !== "" && !(k in description)) description[k] = v;
  };
  put("برند", p.brand?.name);
  put("مدل", p.modelCode);
  put("رنگ", p.colorName);
  for (const group of p.specs) for (const row of group.rows) put(row.label, row.value);
  if (p.warrantyText !== undefined) put("گارانتی", p.warrantyText);
  else if (p.warrantyMonths !== undefined && p.warrantyMonths > 0) put("گارانتی", `${String(p.warrantyMonths)} ماه`);

  const rial = Math.round(p.price * 10);
  const subtitle = [p.brand?.nameEn, p.modelCode].filter((s): s is string => typeof s === "string" && s.trim() !== "").join(" ");
  return {
    id: String(p.id),
    title: p.displayName,
    subtitle: subtitle !== "" ? subtitle : p.name,
    link: absUrl(ctx.origin, productUrl(p.slug)),
    image_link: images,
    availability: p.available ? "in stock" : "out of stock",
    regular_price: p.compareAt !== undefined && p.compareAt > p.price ? Math.round(p.compareAt * 10) : rial,
    sale_price: rial,
    category: ctx.categoryPath,
    brand: p.brand?.name ?? "",
    description,
    GTIN: null,
    ...(typeof p.colorName === "string" && p.colorName.trim() !== "" ? { color: p.colorName.trim() } : {}),
  };
}
