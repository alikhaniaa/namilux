import { collapseSpaces, normalizeArabicLetters, stripControl } from "@namilux/core/client";
// Type-only: erased at build, so this module stays safe to import from client components.
import type { AdminProductFilter, AdminSort } from "@namilux/core";

/**
 * One parser for the product list's URL, shared by `/products` and `/products/bulk-price`, so the
 * rows an admin sees on the list are exactly the rows a «همهٔ نتایج این فیلتر» price change reaches.
 *
 * The search text is normalised here only as far as the admin can do safely without the core
 * (Arabic ي/ك folded to ی/ک, control characters and runs of spaces dropped, a stray `%` removed so
 * it cannot turn the core's `ilike '%q%'` into match-everything). Matching against the normalised
 * `search_text` column is the core's job.
 */

type SP = Record<string, string | string[] | undefined> | URLSearchParams;

const SORTS: readonly AdminSort[] = ["updated", "price_asc", "price_desc", "name", "stock_asc"];
const STATUSES = ["draft", "active", "archived"] as const;
const STOCK = ["in", "out", "low", "backorder"] as const;
const PRICE = ["priced", "on_request", "sale"] as const;
const MISSING = ["image", "description", "spec", "seo"] as const;
export const PRODUCT_PAGE_SIZES = [50, 100, 200] as const;

/** The URL keys that narrow the product set (paging and sorting never do). */
export const PRODUCT_FILTER_KEYS = ["q", "brandId", "status", "stockState", "priceState", "missing"] as const;

function first(sp: SP, key: string): string | undefined {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? undefined;
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

function oneOf<T extends string>(list: readonly T[], v: string | undefined): T | undefined {
  return v !== undefined && (list as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function normalizeProductQuery(raw: string): string {
  return collapseSpaces(normalizeArabicLetters(stripControl(raw)).replace(/%/g, " ")).slice(0, 120);
}

/** True when the text can actually narrow a search - «  »، «%» or «-» alone cannot. */
export function isMeaningfulQuery(q: string): boolean {
  return /[\p{L}\p{N}]/u.test(q);
}

export function parseProductFilter(sp: SP): AdminProductFilter {
  const size = Number(first(sp, "pageSize"));
  const page = Math.trunc(Number(first(sp, "page")));
  const f: AdminProductFilter = {
    page: Number.isFinite(page) && page > 1 ? page : 1,
    pageSize: (PRODUCT_PAGE_SIZES as readonly number[]).includes(size) ? size : 50,
  };
  const q = normalizeProductQuery(first(sp, "q") ?? "");
  if (isMeaningfulQuery(q)) f.q = q;
  const brandId = Number(first(sp, "brandId"));
  if (Number.isInteger(brandId) && brandId > 0) f.brandId = brandId;
  const status = oneOf(STATUSES, first(sp, "status"));
  if (status !== undefined) f.status = status;
  const stock = oneOf(STOCK, first(sp, "stockState"));
  if (stock !== undefined) f.stockState = stock;
  const price = oneOf(PRICE, first(sp, "priceState"));
  if (price !== undefined) f.priceState = price;
  const missing = oneOf(MISSING, first(sp, "missing"));
  if (missing !== undefined) f.missing = missing;
  const sort = oneOf(SORTS, first(sp, "sort"));
  if (sort !== undefined) f.sort = sort;
  return f;
}

/** Does the filter narrow anything? A bulk price change over an empty filter would be the whole catalogue. */
export function hasFilterCriteria(f: AdminProductFilter): boolean {
  return (
    (f.q !== undefined && isMeaningfulQuery(f.q)) ||
    f.brandId !== undefined ||
    f.status !== undefined ||
    f.stockState !== undefined ||
    f.priceState !== undefined ||
    f.missing !== undefined ||
    f.modelId !== undefined ||
    (f.categoryIds !== undefined && f.categoryIds.length > 0) ||
    f.collectionId !== undefined
  );
}

/** The wire shape of `bulkPriceScopeSchema`'s filter branch (core: productFilterSchema). */
export type ProductFilterWire = {
  q?: string;
  brandIds?: number[];
  status?: ("draft" | "active" | "archived")[];
  stockState?: "in" | "out" | "low" | "backorder";
  priceState?: "priced" | "on_request" | "sale";
  missing?: ("image" | "description" | "spec" | "seo")[];
};

export function filterToWire(f: AdminProductFilter): ProductFilterWire {
  return {
    ...(f.q === undefined ? {} : { q: f.q }),
    ...(f.brandId === undefined ? {} : { brandIds: [f.brandId] }),
    ...(f.status === undefined ? {} : { status: [f.status] }),
    ...(f.stockState === undefined ? {} : { stockState: f.stockState }),
    ...(f.priceState === undefined ? {} : { priceState: f.priceState }),
    ...(f.missing === undefined ? {} : { missing: [f.missing] }),
  };
}

/** The wire shape plus the keys only a hand-built body can carry (core's productFilterSchema owns them). */
export type ProductFilterWireFull = ProductFilterWire & {
  categoryIds?: number[];
  collectionIds?: number[];
  modelId?: number;
};

/**
 * What a request body may carry in. Looser than `ProductFilterWireFull` on purpose: zod's
 * `.optional()` infers `prop?: T | undefined`, and under `exactOptionalPropertyTypes` that does not
 * fit a `prop?: T` target.
 */
export type ProductFilterWireInput = {
  q?: string | undefined;
  brandIds?: number[] | undefined;
  categoryIds?: number[] | undefined;
  collectionIds?: number[] | undefined;
  status?: ("draft" | "active" | "archived")[] | undefined;
  stockState?: "in" | "out" | "low" | "backorder" | undefined;
  priceState?: "priced" | "on_request" | "sale" | undefined;
  missing?: ("image" | "description" | "spec" | "seo")[] | undefined;
  modelId?: number | undefined;
};

/**
 * Fold a wire filter's text the same way `/products`' URL parser does, for the bulk-price route.
 * The route receives JSON, not searchParams, so without this an api call could reprice rows the
 * admin never saw: «%» alone reaches the core as a wildcard, and «يخچال» would not fold to the
 * normalised `search_text` the list matches. A `q` that narrows nothing is emptied (the core ignores
 * a blank `q`), so the route's empty-scope guard and the core see the same criteria the list had.
 */
export function normalizeWireFilter(w: ProductFilterWireInput): ProductFilterWireFull {
  const q = w.q === undefined ? undefined : normalizeProductQuery(w.q);
  return {
    ...(q === undefined || !isMeaningfulQuery(q) ? {} : { q }),
    ...(w.brandIds === undefined ? {} : { brandIds: w.brandIds }),
    ...(w.categoryIds === undefined ? {} : { categoryIds: w.categoryIds }),
    ...(w.collectionIds === undefined ? {} : { collectionIds: w.collectionIds }),
    ...(w.status === undefined ? {} : { status: w.status }),
    ...(w.stockState === undefined ? {} : { stockState: w.stockState }),
    ...(w.priceState === undefined ? {} : { priceState: w.priceState }),
    ...(w.missing === undefined ? {} : { missing: w.missing }),
    ...(w.modelId === undefined ? {} : { modelId: w.modelId }),
  };
}

/**
 * The server-side mirror of `hasFilterCriteria` for the wire shape, used by the bulk-price route.
 * Only the first entry of each array is honoured by the core (bulk-price.ts filterScopeToAdmin).
 */
export function wireHasCriteria(w: ProductFilterWireInput): boolean {
  const nonEmpty = (a: unknown[] | undefined): boolean => a !== undefined && a.length > 0;
  return (
    (w.q !== undefined && isMeaningfulQuery(normalizeProductQuery(w.q))) ||
    nonEmpty(w.brandIds) ||
    nonEmpty(w.categoryIds) ||
    nonEmpty(w.collectionIds) ||
    nonEmpty(w.status) ||
    w.stockState !== undefined ||
    w.priceState !== undefined ||
    nonEmpty(w.missing) ||
    w.modelId !== undefined
  );
}

/** A query string carrying just the narrowing keys (for links between list and bulk pages). */
export function filterQueryString(f: AdminProductFilter, extra: Record<string, string> = {}): string {
  const sp = new URLSearchParams();
  if (f.q !== undefined) sp.set("q", f.q);
  if (f.brandId !== undefined) sp.set("brandId", String(f.brandId));
  if (f.status !== undefined) sp.set("status", f.status);
  if (f.stockState !== undefined) sp.set("stockState", f.stockState);
  if (f.priceState !== undefined) sp.set("priceState", f.priceState);
  if (f.missing !== undefined) sp.set("missing", f.missing);
  for (const [k, v] of Object.entries(extra)) sp.set(k, v);
  return sp.toString();
}
