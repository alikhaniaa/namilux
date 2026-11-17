import type { SortKey } from "../url";
import type { ProductCard } from "./cards";

// DECISION (M0 step 3): SORT_KEYS is declared once in ../constants.
import { SORT_KEYS } from "../constants";

export { SORT_KEYS };

export const DEFAULT_SORT: SortKey = "recommended";

export type RecommendedTier = 0 | 1 | 2 | 3;

export type TierInput = Pick<ProductCard, "available" | "onRequest" | "price" | "compareAt">;

export type OrderByColumn =
  | "tier"
  | "is_new"
  | "price_is_zero"
  | "price"
  | "discount_pct"
  | "sold_90d"
  | "published_at"
  | "id";

export type OrderByTerm = { column: OrderByColumn; dir: "asc" | "desc"; nulls?: "last" };

export function isSortKey(s: unknown): s is SortKey {
  return typeof s === "string" && (SORT_KEYS as readonly string[]).includes(s);
}

export function isSaleCard(c: TierInput): boolean {
  return c.compareAt !== undefined && c.price > 0 && c.compareAt > c.price;
}

// DECISION: this file's contract (and cards.ts's) writes `available: boolean`, but the canonical
// ProductCard (../types/product.ts) types it as the availability *count*. Truthiness is the one
// predicate that reads both the same way (0 / false = unavailable), so the tier table does not
// depend on which of the two shapes wins.
export function recommendedTier(c: TierInput): RecommendedTier {
  if (c.available) return c.onRequest ? 1 : 0;
  return isSaleCard(c) ? 2 : 3;
}

// DECISION (M0 step 3): the canonical Badge (../types/common.ts) is a discriminated object union,
// not a string union, so membership is tested on `kind`.
const hasNewBadge = (c: ProductCard): boolean => c.badges.some((b) => b.kind === "new");

function newFirst(a: ProductCard, b: ProductCard): number {
  return Number(hasNewBadge(b)) - Number(hasNewBadge(a));
}

function idDesc(a: ProductCard, b: ProductCard): number {
  return b.id - a.id;
}

export function recommendedSort(a: ProductCard, b: ProductCard): number {
  return recommendedTier(a) - recommendedTier(b) || newFirst(a, b) || idDesc(a, b);
}

// DECISION: the sale percentage is recomputed here (same formula as cards.discountPercent: round,
// clamped 1..99) instead of importing that function or reading the `sale` badge's `percent`.
// dependency list names ./cards for the ProductCard *type* only, and sort.ts must stay a pure comparator
// that works on any card, including one whose badges were dropped (MAX_BADGES = 2).
function pct(c: ProductCard): number {
  if (!isSaleCard(c) || c.compareAt === undefined) return 0;
  const p = Math.round(((c.compareAt - c.price) / c.compareAt) * 100);
  return Math.min(99, Math.max(1, p));
}

const RECOMMENDED_PLAN: readonly OrderByTerm[] = [
  { column: "tier", dir: "asc" },
  { column: "is_new", dir: "desc" },
  { column: "id", dir: "desc" },
];

export function orderByPlan(key: SortKey): readonly OrderByTerm[] {
  switch (key) {
    case "recommended":
      return RECOMMENDED_PLAN;
    case "price_asc":
      return [
        { column: "price_is_zero", dir: "asc" },
        { column: "price", dir: "asc" },
        { column: "id", dir: "desc" },
      ];
    case "price_desc":
      return [
        { column: "price_is_zero", dir: "asc" },
        { column: "price", dir: "desc" },
        { column: "id", dir: "desc" },
      ];
    case "newest":
      return [
        { column: "published_at", dir: "desc", nulls: "last" },
        { column: "id", dir: "desc" },
      ];
    case "discount":
      return [{ column: "discount_pct", dir: "desc" }, ...RECOMMENDED_PLAN];
    case "bestselling":
      return [{ column: "sold_90d", dir: "desc", nulls: "last" }, ...RECOMMENDED_PLAN];
    default: {
      const never: never = key;
      return never;
    }
  }
}

export function sortCards(
  cards: readonly ProductCard[],
  key: SortKey,
  extra?: { sold?: ReadonlyMap<number, number> },
): ProductCard[] {
  const out = [...cards];
  switch (key) {
    case "recommended":
      return out.sort(recommendedSort);
    case "price_asc":
      return out.sort(
        (a, b) =>
          Number(a.price === 0) - Number(b.price === 0) || a.price - b.price || idDesc(a, b),
      );
    case "price_desc":
      return out.sort(
        (a, b) =>
          Number(a.price === 0) - Number(b.price === 0) || b.price - a.price || idDesc(a, b),
      );
    case "newest":
      return out.sort((a, b) => newFirst(a, b) || idDesc(a, b));
    case "discount":
      return out.sort((a, b) => pct(b) - pct(a) || recommendedSort(a, b));
    case "bestselling": {
      const sold = extra?.sold;
      if (!sold) return out.sort(recommendedSort);
      return out.sort(
        (a, b) => (sold.get(b.id) ?? 0) - (sold.get(a.id) ?? 0) || recommendedSort(a, b),
      );
    }
    default: {
      const never: never = key;
      return never;
    }
  }
}
