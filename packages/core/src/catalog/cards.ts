// DECISION (M0 step 3): Badge / VariantSwatch / ProductCard / ImageRef are declared once in ../types
// (the spec §catalog). This module keeps `isLowStock` - see ../inventory/stock.ts - and re-exports the
// canonical card types so every catalog module keeps importing them from here.
// DECISION: `ImageRef` is taken from ./media (this module's dependency list); ./media itself only re-exports
// the ../types declaration, so both routes resolve to the same symbol and `export *` in ./index stays
// unambiguous. cards.ts never calls toImageRef - `ProductCardSource.images` arrives already mapped
// (and alt-fallbacked with the display name) by products.repo.ts, which owns the media rows.
import type { Badge, ProductCard, VariantSwatch } from "../types";
import type { ImageRef } from "./media";

export type { Badge, ImageRef, ProductCard, VariantSwatch };

export type BrandRef = { slug: string; name: string; nameEn: string };

export type StockFacts = {
  stockPolicy: "track" | "untracked";
  stockQty: number;
  reservedQty: number;
  allowBackorder: boolean;
  lowStockThreshold: number;
  maxPerOrder: number;
};

export type ProductCardSource = StockFacts & {
  id: number;
  slug: string;
  name: string;
  displayName: string;
  brand: BrandRef | null;
  modelCode: string | null;
  colorName: string | null;
  colorHex: string | null;
  status: "draft" | "active" | "archived";
  visibility: "public" | "hidden" | "link_only";
  price: number;
  compareAtPrice: number | null;
  publishedAt: string | null;
  ratingAvg: number;
  ratingCount: number;
  images: ImageRef[];
  swatch: ImageRef | null;
  modelId: number | null;
  siblings: VariantSwatch[];
};

export const NEW_DAYS = 30;
export const MAX_BADGES = 2;

const DAY_MS = 86_400_000;

export function availableQty(s: StockFacts): number {
  return Math.max(0, s.stockQty - s.reservedQty);
}

export function isAvailable(s: StockFacts): boolean {
  return s.stockPolicy === "untracked" || availableQty(s) >= 1 || s.allowBackorder;
}

export function isOnRequest(s: { price: number }): boolean {
  return s.price === 0;
}

/**
 * Design audit 2 Sep 2026: a card that can carry a merchandising slot - photographed, buyable now,
 * with a price. Empty-state rails, the related rail and every "way out" pick by this rule (the home
 * already does: home.ts rules); the full catalogue and the listings keep every product.
 */
export function isShowcaseCard(c: Pick<ProductCard, "image" | "available" | "onRequest">): boolean {
  return c.image !== undefined && c.available && !c.onRequest;
}

export function isOnSale(s: { price: number; compareAtPrice: number | null }): boolean {
  return s.compareAtPrice !== null && s.price > 0 && s.compareAtPrice > s.price;
}

export function isLowStock(s: StockFacts): boolean {
  if (s.stockPolicy !== "track") return false;
  const qty = availableQty(s);
  return qty >= 1 && qty <= s.lowStockThreshold;
}

export function isNew(s: { publishedAt: string | null }, now: Date): boolean {
  if (s.publishedAt === null) return false;
  const published = Date.parse(s.publishedAt);
  // DECISION: an unparsable published_at (data drift) is never "new" - a badge is a claim to the
  // customer, so the ambiguous case denies it rather than showing «جدید» for a broken row.
  if (Number.isNaN(published)) return false;
  return now.getTime() - published < NEW_DAYS * DAY_MS;
}

export function discountPercent(price: number, compareAt: number): number {
  if (!(price > 0 && compareAt > price)) return 0;
  const pct = Math.round(((compareAt - price) / compareAt) * 100);
  return Math.min(99, Math.max(1, pct));
}

export function badgesFor(s: ProductCardSource, now: Date): Badge[] {
  const isOut = !isAvailable(s);
  const compareAt = isOnSale(s) ? s.compareAtPrice : null;

  // start-bottom slot: `sale` else `new` (never both) - `new` is suppressed when the row is out.
  const start: Badge | null =
    compareAt !== null
      ? { kind: "sale", percent: discountPercent(s.price, compareAt) }
      : !isOut && isNew(s, now)
        ? { kind: "new" }
        : null;

  // end-bottom slot: `out` else `last` (never both).
  const end: Badge | null = isOut ? { kind: "out" } : isLowStock(s) ? { kind: "last" } : null;

  const badges: Badge[] = [];
  if (start !== null) badges.push(start);
  if (end !== null) badges.push(end);
  return badges.slice(0, MAX_BADGES);
}

export function variantSwatchesFor(s: ProductCardSource): VariantSwatch[] {
  if (s.modelId === null) return [];
  const self: VariantSwatch = {
    productId: s.id,
    slug: s.slug,
    colorName: s.colorName ?? "",
    colorHex: s.colorHex,
    swatch: s.swatch,
    image: s.images[0] ?? null,
    available: isAvailable(s),
    onRequest: isOnRequest(s),
  };
  // DECISION: `siblings` is contracted to exclude self, but a repo/regression that repeats it would
  // render a duplicated swatch, so the merge is keyed by productId and self always wins.
  const byId = new Map<number, VariantSwatch>([[self.productId, self]]);
  for (const sibling of s.siblings) {
    if (!byId.has(sibling.productId)) byId.set(sibling.productId, sibling);
  }
  return [...byId.values()].sort((a, b) => a.productId - b.productId);
}

export function toProductCard(s: ProductCardSource, now: Date = new Date()): ProductCard {
  const compareAt = isOnSale(s) ? s.compareAtPrice : null;
  const modelCode = s.modelCode?.trim() ?? "";
  const colorName = s.colorName?.trim() ?? "";
  // `images` is the already-ordered list of USABLE refs (primary first, then gallery by sort;
  // quarantined/absent rows were dropped by media.toImageRef), so the fallback chain is index 0/1.
  const image = s.images[0];
  const images2 = s.images[1];

  return {
    id: s.id,
    slug: s.slug,
    displayName: s.displayName,
    brand: s.brand,
    ...(modelCode === "" ? {} : { modelCode }),
    price: s.price,
    ...(compareAt === null ? {} : { compareAt }),
    onRequest: isOnRequest(s),
    available: isAvailable(s),
    lowStock: isLowStock(s),
    badges: badgesFor(s, now),
    ...(image === undefined ? {} : { image }),
    ...(images2 === undefined ? {} : { images2 }),
    variants: variantSwatchesFor(s),
    ...(colorName === "" ? {} : { colorName }),
    ...(s.ratingCount >= 1 ? { rating: { avg: s.ratingAvg, count: s.ratingCount } } : {}),
    // sort helpers required by the canonical type and absent from the module contract:
    // publishedAt is carried through; salesRank is not in ProductCardSource (list.ts joins
    // metrics_daily via sort.ts `extra.sold`), so the mapping emits the neutral 0.
    publishedAt: s.publishedAt,
    salesRank: 0,
  };
}
