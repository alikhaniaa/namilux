import { describe, expect, it } from "vitest";
import type { Badge, ProductCard } from "../cards";
import type { SortKey } from "../../url";
import {
  DEFAULT_SORT,
  SORT_KEYS,
  isSaleCard,
  isSortKey,
  orderByPlan,
  recommendedSort,
  recommendedTier,
  sortCards,
} from "../sort";

// ── fixtures ────────────────────────────────────────────────────────────────
// DECISION: cards are built with the badge-slot rule of cards.ts (start slot = sale else new,
// end slot = out else last, `new` suppressed when out) so a fixture can never assert a badge
// combination the mapper would not produce.
const BRAND = { slug: "smeg", name: "SMEG", nameEn: "SMEG" } as const;

type CardInit = {
  id: number;
  price?: number;
  compareAt?: number;
  /** Fixture-only stock count; ProductCard.available is the boolean `count > 0`. */
  available?: number;
  isNew?: boolean;
};

function pctOf(price: number, compareAt: number): number {
  return Math.min(99, Math.max(1, Math.round(((compareAt - price) / compareAt) * 100)));
}

function card(init: CardInit): ProductCard {
  const price = init.price ?? 10_000_000;
  const available = init.available ?? 4;
  const onSale = init.compareAt !== undefined && price > 0 && init.compareAt > price;
  const badges: Badge[] = [];
  if (onSale && init.compareAt !== undefined) {
    badges.push({ kind: "sale", percent: pctOf(price, init.compareAt) });
  } else if (init.isNew === true && available > 0) {
    badges.push({ kind: "new" });
  }
  if (available === 0) badges.push({ kind: "out" });
  return {
    id: init.id,
    slug: `product-${String(init.id)}`,
    displayName: `Product ${String(init.id)}`,
    brand: BRAND,
    price,
    ...(init.compareAt !== undefined ? { compareAt: init.compareAt } : {}),
    onRequest: price === 0,
    available: available > 0,
    lowStock: false,
    badges,
    variants: [],
    publishedAt: null,
    salesRank: 0,
  };
}

const ids = (cards: readonly ProductCard[]): number[] => cards.map((c) => c.id);

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  items.forEach((item, i) => {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([item, ...tail]);
  });
  return out;
}

// ── keys ────────────────────────────────────────────────────────────────────
describe("keys", () => {
  it("SORT_KEYS is the menu order with recommended first and DEFAULT_SORT is recommended", () => {
    expect([...SORT_KEYS]).toEqual([
      "recommended",
      "price_asc",
      "price_desc",
      "newest",
      "discount",
      "bestselling",
    ]);
    expect(SORT_KEYS[0]).toBe("recommended");
    expect(DEFAULT_SORT).toBe("recommended");
    expect(SORT_KEYS).toContain(DEFAULT_SORT);
  });

  it("isSortKey", () => {
    for (const key of SORT_KEYS) expect(isSortKey(key), key).toBe(true);
    const junk: unknown[] = [
      "PRICE_ASC",
      "Recommended",
      "price-asc",
      "price_asc ",
      " price_asc",
      "",
      "bogus",
      "toString",
      "constructor",
      "__proto__",
      undefined,
      null,
      0,
      1,
      true,
      {},
      ["recommended"],
      Symbol("recommended"),
    ];
    junk.forEach((value, i) => {
      expect(isSortKey(value), `junk[${String(i)}]`).toBe(false);
    });
  });
});

// ── tiers ───────────────────────────────────────────────────────────────────
const buyable = card({ id: 1, price: 10_000_000, available: 5 });
const onRequestInStock = card({ id: 2, price: 0, available: 5 });
const saleButOut = card({ id: 3, price: 41_500_000, compareAt: 48_000_000, available: 0 });
const plainOut = card({ id: 4, price: 3_000_000, available: 0 });
const TIER_TABLE = [buyable, onRequestInStock, saleButOut, plainOut] as const;

describe("recommendedTier", () => {
  it("maps the four documented states", () => {
    expect(recommendedTier(buyable)).toBe(0);
    expect(recommendedTier(onRequestInStock)).toBe(1);
    expect(recommendedTier(saleButOut)).toBe(2);
    expect(recommendedTier(plainOut)).toBe(3);
  });

  it("an unavailable on-request row is tier 3, never tier 1", () => {
    expect(recommendedTier(card({ id: 5, price: 0, available: 0 }))).toBe(3);
  });

  it("an available sale row is tier 0, never tier 2", () => {
    expect(
      recommendedTier(card({ id: 6, price: 41_500_000, compareAt: 48_000_000, available: 2 })),
    ).toBe(0);
  });
});

describe("isSaleCard", () => {
  it("requires compareAt > price > 0", () => {
    expect(isSaleCard({ available: true, onRequest: false, price: 90, compareAt: 100 })).toBe(true);
    expect(isSaleCard({ available: true, onRequest: false, price: 100, compareAt: 100 })).toBe(false);
    expect(isSaleCard({ available: true, onRequest: false, price: 100, compareAt: 90 })).toBe(false);
    expect(isSaleCard({ available: true, onRequest: true, price: 0, compareAt: 100 })).toBe(false);
    expect(isSaleCard({ available: true, onRequest: false, price: 100 })).toBe(false);
  });
});

describe("sortCards · recommended", () => {
  it("sort order table", () => {
    const expected = [1, 2, 3, 4];
    const perms = permutations(TIER_TABLE);
    expect(perms).toHaveLength(24);
    for (const perm of perms) {
      expect(ids(sortCards(perm, "recommended")), ids(perm).join(",")).toEqual(expected);
      expect(ids([...perm].sort(recommendedSort)), ids(perm).join(",")).toEqual(expected);
    }
  });

  it("new before older within tier", () => {
    const older = card({ id: 10, isNew: true });
    const newer = card({ id: 11 });
    expect(ids(sortCards([newer, older], "recommended"))).toEqual([10, 11]);
    expect(ids(sortCards([older, newer], "recommended"))).toEqual([10, 11]);

    // same tier, no badge → higher id first
    const low = card({ id: 20 });
    const high = card({ id: 21 });
    expect(ids(sortCards([low, high], "recommended"))).toEqual([21, 20]);

    // the badge never crosses a tier boundary
    const newButOnRequest = card({ id: 30, price: 0, available: 3, isNew: true });
    expect(ids(sortCards([newButOnRequest, low], "recommended"))).toEqual([20, 30]);
  });
});

describe("sortCards · price", () => {
  const a = card({ id: 40, price: 5_000_000 });
  const b = card({ id: 41, price: 5_000_000 });
  const zero1 = card({ id: 42, price: 0 });
  const dear = card({ id: 43, price: 12_000_000 });
  const zero2 = card({ id: 44, price: 0 });
  const rows = [a, b, zero1, dear, zero2];

  it("price_asc on-request last", () => {
    expect(ids(sortCards(rows, "price_asc"))).toEqual([41, 40, 43, 44, 42]);
  });

  it("price_desc keeps on-request last too", () => {
    expect(ids(sortCards(rows, "price_desc"))).toEqual([43, 41, 40, 44, 42]);
  });

  it("price ignores the availability tier", () => {
    const cheapOut = card({ id: 45, price: 1_000_000, available: 0 });
    expect(ids(sortCards([a, cheapOut], "price_asc"))).toEqual([45, 40]);
  });
});

describe("sortCards · discount", () => {
  it("discount pct ordering", () => {
    const half = card({ id: 50, price: 50, compareAt: 100 });
    const tenth = card({ id: 51, price: 90, compareAt: 100 });
    const plain1 = card({ id: 52 });
    const plain2 = card({ id: 53 });
    const clampedUp = card({ id: 54, price: 999, compareAt: 1000 }); // round → 0, clamped to 1
    const clampedDown = card({ id: 55, price: 1, compareAt: 1000 }); // round → 100, clamped to 99
    const ninetyNine = card({ id: 56, price: 10, compareAt: 1000 }); // exactly 99

    expect(
      ids(sortCards([plain1, tenth, clampedDown, half, plain2, ninetyNine, clampedUp], "discount")),
    ).toEqual([56, 55, 50, 51, 54, 53, 52]);
  });

  it("percentage beats the availability tier, then the recommended keys break ties", () => {
    const outButOnSale = card({ id: 60, price: 90, compareAt: 100, available: 0 });
    const buyableNoSale = card({ id: 61 });
    expect(ids(sortCards([buyableNoSale, outButOnSale], "discount"))).toEqual([60, 61]);

    const sameSaleBuyable = card({ id: 62, price: 90, compareAt: 100, available: 3 });
    expect(ids(sortCards([outButOnSale, sameSaleBuyable], "discount"))).toEqual([62, 60]);
  });
});

describe("sortCards · newest", () => {
  it("puts the new badge first, then the highest id", () => {
    const flagged = card({ id: 70, isNew: true });
    const older = card({ id: 71 });
    const oldest = card({ id: 72 });
    expect(ids(sortCards([older, oldest, flagged], "newest"))).toEqual([70, 72, 71]);
  });
});

describe("sortCards · bestselling", () => {
  const rows = [...TIER_TABLE];

  it("bestselling falls back", () => {
    const expected = ids(sortCards(rows, "recommended"));
    expect(ids(sortCards(rows, "bestselling"))).toEqual(expected);
    expect(ids(sortCards(rows, "bestselling", {}))).toEqual(expected);
    expect(ids(sortCards(rows, "bestselling", { sold: new Map() }))).toEqual(expected);
  });

  it("orders by the 90-day sold map before the recommended keys", () => {
    const slow = card({ id: 80, available: 3 });
    const fast = card({ id: 81, available: 3 });
    const soldOutHit = card({ id: 82, available: 0 });
    const sold = new Map([
      [80, 2],
      [81, 9],
      [82, 100],
    ]);
    expect(ids(sortCards([slow, fast, soldOutHit], "bestselling", { sold }))).toEqual([82, 81, 80]);

    // a product missing from the map counts as 0 and falls to the recommended order
    const unknown = card({ id: 83, available: 3 });
    expect(ids(sortCards([unknown, slow], "bestselling", { sold }))).toEqual([80, 83]);
  });
});

// ── ORDER BY plans ──────────────────────────────────────────────────────────
describe("orderByPlan", () => {
  it("plans end with id desc", () => {
    for (const key of SORT_KEYS) {
      const plan = orderByPlan(key);
      expect(plan.length, key).toBeGreaterThan(0);
      expect(plan[plan.length - 1], key).toEqual({ column: "id", dir: "desc" });
      // one column may not repeat inside a plan, otherwise the later term is dead
      const columns = plan.map((t) => t.column);
      expect(new Set(columns).size, key).toBe(columns.length);
    }
  });

  it("prints the documented terms for every key", () => {
    const recommended = [
      { column: "tier", dir: "asc" },
      { column: "is_new", dir: "desc" },
      { column: "id", dir: "desc" },
    ];
    expect(orderByPlan("recommended")).toEqual(recommended);
    expect(orderByPlan("price_asc")).toEqual([
      { column: "price_is_zero", dir: "asc" },
      { column: "price", dir: "asc" },
      { column: "id", dir: "desc" },
    ]);
    expect(orderByPlan("price_desc")).toEqual([
      { column: "price_is_zero", dir: "asc" },
      { column: "price", dir: "desc" },
      { column: "id", dir: "desc" },
    ]);
    expect(orderByPlan("newest")).toEqual([
      { column: "published_at", dir: "desc", nulls: "last" },
      { column: "id", dir: "desc" },
    ]);
    expect(orderByPlan("discount")).toEqual([
      { column: "discount_pct", dir: "desc" },
      ...recommended,
    ]);
    expect(orderByPlan("bestselling")).toEqual([
      { column: "sold_90d", dir: "desc", nulls: "last" },
      ...recommended,
    ]);
  });

  it("only the two nullable columns ask for nulls last", () => {
    for (const key of SORT_KEYS) {
      for (const term of orderByPlan(key)) {
        if (term.column === "published_at" || term.column === "sold_90d") {
          expect(term.nulls, `${key}.${term.column}`).toBe("last");
        } else {
          expect(term.nulls, `${key}.${term.column}`).toBeUndefined();
        }
      }
    }
    expect(orderByPlan("bestselling").some((t) => t.column === "sold_90d")).toBe(true);
    expect(orderByPlan("newest").some((t) => t.column === "published_at")).toBe(true);
  });
});

// ── purity ──────────────────────────────────────────────────────────────────
describe("purity", () => {
  it("sortCards is non-mutating", () => {
    const input = [plainOut, buyable, saleButOut, onRequestInStock];
    const before = ids(input);
    const frozen = Object.freeze([...input]);
    for (const key of SORT_KEYS) {
      const out = sortCards(frozen, key, { sold: new Map([[1, 3]]) });
      expect(out, key).not.toBe(frozen);
      expect(ids(frozen), key).toEqual(before);
      expect(out, key).toHaveLength(before.length);
    }
    expect(ids(input)).toEqual(before);
  });

  it("keeps equal rows in input order (stable)", () => {
    // two rows with the same id are indistinguishable to every comparator key
    const twinA = { ...card({ id: 90 }), slug: "twin-a" };
    const twinB = { ...card({ id: 90 }), slug: "twin-b" };
    for (const key of SORT_KEYS) {
      expect(sortCards([twinA, twinB], key).map((c) => c.slug), key).toEqual(["twin-a", "twin-b"]);
    }
  });

  it("an empty list and a single card are returned as new arrays", () => {
    const one = [buyable];
    for (const key of SORT_KEYS) {
      expect(sortCards([], key), key).toEqual([]);
      expect(sortCards(one, key), key).not.toBe(one);
      expect(ids(sortCards(one, key)), key).toEqual([1]);
    }
  });

  it("recommendedSort is antisymmetric over the tier table", () => {
    for (const a of TIER_TABLE) {
      for (const b of TIER_TABLE) {
        // sum, not negation: Math.sign(0) is +0 and -Math.sign(0) is -0 under Object.is
        expect(Math.sign(recommendedSort(a, b)) + Math.sign(recommendedSort(b, a))).toBe(0);
        expect(recommendedSort(a, a)).toBe(0);
      }
    }
  });

  it("every SortKey is accepted by sortCards", () => {
    const keys: SortKey[] = [...SORT_KEYS];
    for (const key of keys) expect(sortCards(TIER_TABLE, key)).toHaveLength(4);
  });
});
