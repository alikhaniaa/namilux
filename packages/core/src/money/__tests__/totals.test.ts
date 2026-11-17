import { describe, expect, it } from "vitest";
import { assertTotalsInvariant, computeTotals, couponAmountFor, percentOff, roundToman, savings, type ComputeTotalsInput } from "../totals";
import { isAppError } from "../../errors";
import { MAX_CART_LINES } from "../../constants";
import type { CouponEval, PricedLine, Totals } from "../../types/order";

// ---------------------------------------------------------------- helpers
const line = (productId: number, unitPrice: number, qty = 1, compareAt: number | null = null): PricedLine => ({
  productId,
  unitPrice,
  qty,
  compareAt,
});

const coupon = (over: Partial<CouponEval>): CouponEval => ({
  couponId: 1,
  code: "NAMILUX8",
  kind: "percent",
  value: 10,
  maxDiscount: null,
  minSubtotal: 0,
  eligibleProductIds: "all",
  stackableWithPoints: true,
  ...over,
});

/** Returns the AppError code instead of throwing, so validation cases stay table-driven. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "NO_THROW";
  } catch (e) {
    return isAppError(e) ? e.code : "NOT_APP_ERROR";
  }
}

type Expected = Pick<Totals, "subtotal" | "couponAmount" | "discount" | "pointsDiscount" | "shipping" | "grandTotal" | "freeShipping">;

type Row = {
  name: string;
  lines: PricedLine[];
  coupon?: CouponEval;
  pointsValue?: number;
  shipping?: number;
  want: Expected;
};

const run = (row: Row): Totals => {
  const input: ComputeTotalsInput = {
    lines: row.lines,
    pointsValue: row.pointsValue ?? 0,
    shipping: row.shipping ?? 0,
    ...(row.coupon ? { coupon: row.coupon } : {}),
  };
  return computeTotals(input);
};

// ---------------------------------------------------------------- the table
const TWO_LINES = [line(1, 10_000_000, 2), line(2, 5_000_000, 1)];

const ROWS: Row[] = [
  {
    name: "single line, no coupon, no points, no shipping",
    lines: [line(1, 41_500_000, 1)],
    want: { subtotal: 41_500_000, couponAmount: 0, discount: 0, pointsDiscount: 0, shipping: 0, grandTotal: 41_500_000, freeShipping: false },
  },
  {
    name: "two lines sum to the subtotal",
    lines: TWO_LINES,
    want: { subtotal: 25_000_000, couponAmount: 0, discount: 0, pointsDiscount: 0, shipping: 0, grandTotal: 25_000_000, freeShipping: false },
  },
  {
    name: "percent 10 on all",
    lines: TWO_LINES,
    coupon: coupon({ kind: "percent", value: 10 }),
    want: { subtotal: 25_000_000, couponAmount: 2_500_000, discount: 2_500_000, pointsDiscount: 0, shipping: 0, grandTotal: 22_500_000, freeShipping: false },
  },
  {
    name: "percent 10 capped by maxDiscount",
    lines: TWO_LINES,
    coupon: coupon({ kind: "percent", value: 10, maxDiscount: 1_000_000 }),
    want: { subtotal: 25_000_000, couponAmount: 1_000_000, discount: 1_000_000, pointsDiscount: 0, shipping: 0, grandTotal: 24_000_000, freeShipping: false },
  },
  {
    name: "percent 15 floors the rial fraction",
    lines: [line(1, 1_000_001, 1)],
    coupon: coupon({ kind: "percent", value: 15 }),
    want: { subtotal: 1_000_001, couponAmount: 150_000, discount: 150_000, pointsDiscount: 0, shipping: 0, grandTotal: 850_001, freeShipping: false },
  },
  {
    name: "fixed larger than the eligible subtotal is capped at it",
    lines: [line(1, 2_000_000, 1)],
    coupon: coupon({ kind: "fixed", value: 3_000_000 }),
    want: { subtotal: 2_000_000, couponAmount: 2_000_000, discount: 2_000_000, pointsDiscount: 0, shipping: 0, grandTotal: 0, freeShipping: false },
  },
  {
    name: "fixed with an empty eligible list discounts nothing",
    lines: [line(1, 2_000_000, 1)],
    coupon: coupon({ kind: "fixed", value: 3_000_000, eligibleProductIds: [] }),
    want: { subtotal: 2_000_000, couponAmount: 0, discount: 0, pointsDiscount: 0, shipping: 0, grandTotal: 2_000_000, freeShipping: false },
  },
  {
    name: "eligible subtotal below minSubtotal discounts nothing",
    lines: [line(1, 4_000_000, 1)],
    coupon: coupon({ kind: "percent", value: 10, minSubtotal: 5_000_000 }),
    want: { subtotal: 4_000_000, couponAmount: 0, discount: 0, pointsDiscount: 0, shipping: 0, grandTotal: 4_000_000, freeShipping: false },
  },
  {
    name: "free_shipping zeroes the shipping and never the items",
    lines: [line(1, 4_000_000, 1)],
    coupon: coupon({ kind: "free_shipping", value: 0 }),
    shipping: 350_000,
    want: { subtotal: 4_000_000, couponAmount: 0, discount: 0, pointsDiscount: 0, shipping: 0, grandTotal: 4_000_000, freeShipping: true },
  },
  {
    name: "free_shipping with an unmet minimum leaves the shipping alone",
    lines: [line(1, 4_000_000, 1)],
    coupon: coupon({ kind: "free_shipping", value: 0, minSubtotal: 10_000_000 }),
    shipping: 350_000,
    want: { subtotal: 4_000_000, couponAmount: 0, discount: 0, pointsDiscount: 0, shipping: 350_000, grandTotal: 4_350_000, freeShipping: false },
  },
  {
    name: "points never push the remainder below zero",
    lines: [line(1, 1_000_000, 1)],
    pointsValue: 1_200_000,
    want: { subtotal: 1_000_000, couponAmount: 0, discount: 0, pointsDiscount: 1_000_000, shipping: 0, grandTotal: 0, freeShipping: false },
  },
  {
    name: "non-stackable coupon with an amount blocks the points",
    lines: [line(1, 1_000_000, 1)],
    coupon: coupon({ kind: "percent", value: 10, stackableWithPoints: false }),
    pointsValue: 500_000,
    want: { subtotal: 1_000_000, couponAmount: 100_000, discount: 100_000, pointsDiscount: 0, shipping: 0, grandTotal: 900_000, freeShipping: false },
  },
  {
    name: "non-stackable coupon with amount 0 (unmet min) still allows the points",
    lines: [line(1, 1_000_000, 1)],
    coupon: coupon({ kind: "fixed", value: 500_000, minSubtotal: 5_000_000, stackableWithPoints: false }),
    pointsValue: 500_000,
    want: { subtotal: 1_000_000, couponAmount: 0, discount: 0, pointsDiscount: 500_000, shipping: 0, grandTotal: 500_000, freeShipping: false },
  },
  {
    name: "shipping is added after every discount",
    lines: [line(1, 1_000_000, 1)],
    coupon: coupon({ kind: "percent", value: 10 }),
    pointsValue: 200_000,
    shipping: 350_000,
    want: { subtotal: 1_000_000, couponAmount: 100_000, discount: 100_000, pointsDiscount: 200_000, shipping: 350_000, grandTotal: 1_050_000, freeShipping: false },
  },
];

describe("computeTotals table", () => {
  for (const row of ROWS) {
    it(row.name, () => {
      const t = run(row);
      expect({
        subtotal: t.subtotal,
        couponAmount: t.couponAmount,
        discount: t.discount,
        pointsDiscount: t.pointsDiscount,
        shipping: t.shipping,
        grandTotal: t.grandTotal,
        freeShipping: t.freeShipping,
      }).toEqual(row.want);
      expect(() => assertTotalsInvariant(t)).not.toThrow();
    });
  }

  it("returns one TotalsLine per input line with lineTotal = unitPrice × qty", () => {
    const t = computeTotals({ lines: TWO_LINES, pointsValue: 0, shipping: 0 });
    expect(t.lines).toEqual([
      { productId: 1, qty: 2, unitPrice: 10_000_000, lineTotal: 20_000_000 },
      { productId: 2, qty: 1, unitPrice: 5_000_000, lineTotal: 5_000_000 },
    ]);
  });

  it("percent/fixed coupons never touch the shipping cost", () => {
    const t = computeTotals({ lines: [line(1, 4_000_000)], coupon: coupon({ kind: "fixed", value: 1_000_000 }), pointsValue: 0, shipping: 350_000 });
    expect(t.shipping).toBe(350_000);
    expect(t.freeShipping).toBe(false);
  });

  it("an eligible-list coupon discounts only the eligible lines", () => {
    const t = computeTotals({
      lines: TWO_LINES,
      coupon: coupon({ kind: "percent", value: 10, eligibleProductIds: [2] }),
      pointsValue: 0,
      shipping: 0,
    });
    expect(t.couponAmount).toBe(500_000); // 10 % of line 2 only
  });
});

describe("computeTotals validation rejects", () => {
  const rows: { name: string; input: ComputeTotalsInput }[] = [
    { name: "unitPrice 0 (on-request must never reach here)", input: { lines: [line(1, 0)], pointsValue: 0, shipping: 0 } },
    { name: "qty 0", input: { lines: [line(1, 1_000, 0)], pointsValue: 0, shipping: 0 } },
    { name: "unitPrice 1.5 (float)", input: { lines: [line(1, 1.5)], pointsValue: 0, shipping: 0 } },
    { name: "negative pointsValue", input: { lines: [line(1, 1_000)], pointsValue: -1, shipping: 0 } },
    { name: "negative shipping", input: { lines: [line(1, 1_000)], pointsValue: 0, shipping: -1 } },
    { name: "float shipping", input: { lines: [line(1, 1_000)], pointsValue: 0, shipping: 350_000.5 } },
    { name: "NaN pointsValue", input: { lines: [line(1, 1_000)], pointsValue: Number.NaN, shipping: 0 } },
    { name: "Infinity unitPrice", input: { lines: [line(1, Number.POSITIVE_INFINITY)], pointsValue: 0, shipping: 0 } },
    {
      name: `${MAX_CART_LINES + 1} lines`,
      input: { lines: Array.from({ length: MAX_CART_LINES + 1 }, (_, k) => line(k + 1, 1_000)), pointsValue: 0, shipping: 0 },
    },
    { name: "duplicate productId", input: { lines: [line(7, 1_000), line(7, 2_000)], pointsValue: 0, shipping: 0 } },
    { name: "empty lines", input: { lines: [], pointsValue: 0, shipping: 0 } },
  ];

  for (const row of rows) {
    it(row.name, () => {
      expect(codeOf(() => computeTotals(row.input))).toBe("VALIDATION");
    });
  }

  it(`accepts exactly ${MAX_CART_LINES} lines`, () => {
    const lines = Array.from({ length: MAX_CART_LINES }, (_, k) => line(k + 1, 1_000));
    expect(computeTotals({ lines, pointsValue: 0, shipping: 0 }).subtotal).toBe(MAX_CART_LINES * 1_000);
  });

  it("carries { field, productId } in details", () => {
    try {
      computeTotals({ lines: [line(1, 1_000), line(2, 0)], pointsValue: 0, shipping: 0 });
      throw new Error("expected VALIDATION");
    } catch (e) {
      expect(isAppError(e)).toBe(true);
      if (isAppError(e)) expect(e.details).toEqual({ field: "lines.unitPrice", productId: 2 });
    }
  });
});

describe("assertTotalsInvariant", () => {
  const good = (): Totals => computeTotals({ lines: [line(1, 1_000_000)], pointsValue: 0, shipping: 350_000 });

  it("passes on a computed Totals", () => {
    expect(() => assertTotalsInvariant(good())).not.toThrow();
  });

  it("throws INTERNAL when the grand total is tampered with", () => {
    const t = { ...good(), grandTotal: good().grandTotal + 1 };
    expect(codeOf(() => assertTotalsInvariant(t))).toBe("INTERNAL");
  });

  it("throws INTERNAL when a term is negative", () => {
    const t = { ...good(), pointsDiscount: -1 };
    expect(codeOf(() => assertTotalsInvariant(t))).toBe("INTERNAL");
  });

  it("throws INTERNAL when a lineTotal does not equal unitPrice × qty", () => {
    const base = good();
    const first = base.lines[0];
    if (!first) throw new Error("fixture has no lines");
    const t: Totals = { ...base, lines: [{ ...first, lineTotal: first.lineTotal + 1 }] };
    expect(codeOf(() => assertTotalsInvariant(t))).toBe("INTERNAL");
  });
});

describe("invariant 1 holds for 200 seeded random inputs", () => {
  // Deterministic LCG - no Math.random and no host-dependent output.
  const lcg = (seed: number) => {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0x1_0000_0000;
    };
  };

  it("never produces a negative term and always satisfies the identity", () => {
    const rnd = lcg(20260825);
    const int = (max: number) => Math.floor(rnd() * (max + 1));
    const kinds = ["percent", "fixed", "free_shipping"] as const;

    for (let run_ = 0; run_ < 200; run_ += 1) {
      const count = 1 + int(MAX_CART_LINES - 1);
      const lines = Array.from({ length: count }, (_, k) => line(k + 1, 1 + int(50_000_000), 1 + int(4)));
      const kind = kinds[int(2)] ?? "percent";
      const withCoupon = rnd() < 0.7;
      const c = coupon({
        kind,
        value: kind === "percent" ? int(100) : int(80_000_000),
        maxDiscount: rnd() < 0.5 ? int(5_000_000) : null,
        minSubtotal: rnd() < 0.5 ? int(30_000_000) : 0,
        eligibleProductIds: rnd() < 0.5 ? "all" : lines.filter(() => rnd() < 0.5).map((l) => l.productId),
        stackableWithPoints: rnd() < 0.5,
      });
      const input: ComputeTotalsInput = {
        lines,
        pointsValue: int(20_000_000),
        shipping: rnd() < 0.5 ? 0 : int(1_000_000),
        ...(withCoupon ? { coupon: c } : {}),
      };

      const t = computeTotals(input);
      expect(() => assertTotalsInvariant(t)).not.toThrow();
      expect(t.grandTotal).toBeGreaterThanOrEqual(0);
      expect(t.discount).toBeLessThanOrEqual(t.subtotal);
      expect(t.pointsDiscount).toBeLessThanOrEqual(t.subtotal - t.discount);
      for (const value of [t.subtotal, t.couponAmount, t.discount, t.pointsDiscount, t.shipping, t.grandTotal]) {
        expect(Number.isSafeInteger(value)).toBe(true);
      }
    }
  });
});

describe("couponAmountFor", () => {
  it("matches the couponAmount computeTotals produces", () => {
    const c = coupon({ kind: "percent", value: 10, maxDiscount: 1_000_000 });
    expect(couponAmountFor(c, TWO_LINES)).toBe(computeTotals({ lines: TWO_LINES, coupon: c, pointsValue: 0, shipping: 0 }).couponAmount);
  });

  it("is 0 for a free_shipping coupon (it never reduces the items)", () => {
    expect(couponAmountFor(coupon({ kind: "free_shipping", value: 0 }), TWO_LINES)).toBe(0);
  });

  it("is 0 when the minimum is not met", () => {
    expect(couponAmountFor(coupon({ kind: "fixed", value: 1_000_000, minSubtotal: 99_000_000 }), TWO_LINES)).toBe(0);
  });
});

describe("percentOff / savings table", () => {
  const rows: { price: number; compareAt: number | null | undefined; pct: number | null; save: number | null }[] = [
    { price: 41_500_000, compareAt: 48_000_000, pct: 13, save: 6_500_000 },
    { price: 100, compareAt: 100, pct: null, save: null },
    { price: 0, compareAt: 100, pct: null, save: null },
    { price: 100, compareAt: null, pct: null, save: null },
    { price: 100, compareAt: undefined, pct: null, save: null },
    { price: 100, compareAt: 90, pct: null, save: null },
    { price: 999, compareAt: 1_000, pct: null, save: 1 }, // rounds to 0 % → no badge, but the saving is real
    { price: 50, compareAt: 100, pct: 50, save: 50 },
    { price: 1, compareAt: 2, pct: 50, save: 1 },
    { price: 1.5, compareAt: 100, pct: null, save: null },
    { price: Number.NaN, compareAt: 100, pct: null, save: null },
    { price: 100, compareAt: Number.POSITIVE_INFINITY, pct: null, save: null },
  ];

  for (const row of rows) {
    it(`percentOff(${row.price}, ${String(row.compareAt)}) → ${String(row.pct)} · savings → ${String(row.save)}`, () => {
      expect(percentOff(row.price, row.compareAt)).toBe(row.pct);
      expect(savings(row.price, row.compareAt)).toBe(row.save);
    });
  }
});

describe("roundToman table", () => {
  const rows: { n: number; to: 10_000 | 100_000; want: number }[] = [
    { n: 41_555_000, to: 10_000, want: 41_560_000 },
    { n: 41_555_000, to: 100_000, want: 41_600_000 },
    { n: 41_549_999, to: 100_000, want: 41_500_000 },
    { n: 41_550_000, to: 100_000, want: 41_600_000 }, // exactly a half → up
    { n: 0, to: 10_000, want: 0 },
    { n: 4_999, to: 10_000, want: 0 },
    { n: 5_000, to: 10_000, want: 10_000 },
    { n: 10_000, to: 10_000, want: 10_000 },
    { n: 41_500_000, to: 100_000, want: 41_500_000 },
  ];

  for (const row of rows) {
    it(`roundToman(${row.n}, ${row.to}) → ${row.want}`, () => {
      expect(roundToman(row.n, row.to)).toBe(row.want);
    });
  }

  it("rejects a float, a negative and an unsupported step", () => {
    expect(codeOf(() => roundToman(1.5, 10_000))).toBe("VALIDATION");
    expect(codeOf(() => roundToman(-10_000, 10_000))).toBe("VALIDATION");
    expect(codeOf(() => roundToman(Number.NaN, 10_000))).toBe("VALIDATION");
    expect(codeOf(() => roundToman(1_000, 1_000 as unknown as 10_000))).toBe("VALIDATION");
  });
});
