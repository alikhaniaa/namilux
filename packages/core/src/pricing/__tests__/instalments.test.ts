import { describe, expect, it } from "vitest";

import { DEFAULT_INSTALMENTS_RULE, deriveInstalmentPrice, instalmentsRule, markupStep, resolveInstalmentPrice } from "../instalments";
import type { InstalmentsRule } from "../instalments";

const R: InstalmentsRule = { commissionPercent: 10, roundTo: 10_000 };

describe("pricing/instalments - deriveInstalmentPrice", () => {
  it("100 000 000 at 10 % rounded to 10 000 → 111 120 000", () => {
    // 100 000 000 / 0.9 = 111 111 111.11 → ceil to the next 10 000 step
    expect(deriveInstalmentPrice(100_000_000, R)).toBe(111_120_000);
  });

  it("price 0 (on request) stays 0 - the gross-up never invents a price", () => {
    expect(deriveInstalmentPrice(0, R)).toBe(0);
  });

  it("rounds UP, never to the nearest step", () => {
    // 9 000 000 / 0.9 = exactly 10 000 000 - already on a step, so nothing is added.
    expect(deriveInstalmentPrice(9_000_000, R)).toBe(10_000_000);
    // One Toman more must cross to the next step rather than round back down.
    expect(deriveInstalmentPrice(9_000_001, R)).toBe(10_010_000);
    expect(deriveInstalmentPrice(1, R)).toBe(10_000);
  });

  it("honours the step: the same price at 1 000 / 100 000 / 1 000 000", () => {
    expect(deriveInstalmentPrice(100_000_000, { commissionPercent: 10, roundTo: 1_000 })).toBe(111_112_000);
    expect(deriveInstalmentPrice(100_000_000, { commissionPercent: 10, roundTo: 100_000 })).toBe(111_200_000);
    expect(deriveInstalmentPrice(100_000_000, { commissionPercent: 10, roundTo: 1_000_000 })).toBe(112_000_000);
  });

  it("commission 0 only rounds up; the result is always ≥ the fixed price", () => {
    expect(deriveInstalmentPrice(41_500_000, { commissionPercent: 0, roundTo: 10_000 })).toBe(41_500_000);
    expect(deriveInstalmentPrice(41_505_000, { commissionPercent: 0, roundTo: 10_000 })).toBe(41_510_000);
  });

  it("a negative or non-finite price is 0, never a negative listing", () => {
    expect(deriveInstalmentPrice(-1, R)).toBe(0);
    expect(deriveInstalmentPrice(Number.NaN, R)).toBe(0);
  });

  it("returns whole Toman", () => {
    for (const price of [1, 999, 12_345_678, 999_999_999]) {
      expect(Number.isInteger(deriveInstalmentPrice(price, R))).toBe(true);
    }
  });
});

describe("pricing/instalments - resolveInstalmentPrice", () => {
  it("derives when the row is not pinned, ignoring whatever is stored", () => {
    expect(
      resolveInstalmentPrice({ price: 100_000_000, instalmentPrice: 1, instalmentPriceManual: false }, R),
    ).toBe(111_120_000);
    expect(
      resolveInstalmentPrice({ price: 100_000_000, instalmentPrice: null, instalmentPriceManual: false }, R),
    ).toBe(111_120_000);
  });

  it("respects a manual override, whatever the rule says", () => {
    expect(
      resolveInstalmentPrice({ price: 100_000_000, instalmentPrice: 123_450_000, instalmentPriceManual: true }, R),
    ).toBe(123_450_000);
  });

  it("a pinned row with no value is on request (0), like price 0", () => {
    expect(
      resolveInstalmentPrice({ price: 100_000_000, instalmentPrice: null, instalmentPriceManual: true }, R),
    ).toBe(0);
  });
});

describe("pricing/instalments - the rule", () => {
  it("the default is 10 % rounded to 10 000", () => {
    expect(DEFAULT_INSTALMENTS_RULE).toEqual({ commissionPercent: 10, roundTo: 10_000 });
  });

  it("instalmentsRule picks exactly the two fields out of the settings group", () => {
    expect(
      instalmentsRule({
        "commerce.installments": { commissionPercent: 12.5, roundTo: 100_000 },
      }),
    ).toEqual({ commissionPercent: 12.5, roundTo: 100_000 });
  });
});

describe("deriveInstalmentPrice: markup rule (owner, 15 Sep 2026: +15 %, rounded up)", () => {
  const rule = { commissionPercent: 10, roundTo: 1_000_000, markupPercent: 15 };

  it("adds the markup and rounds up by a step of at most a twentieth of the price", () => {
    expect(deriveInstalmentPrice(64_455_000, rule)).toBe(75_000_000); // 74,123,250 → 75,000,000
    expect(deriveInstalmentPrice(100_000_000, rule)).toBe(115_000_000); // exact: never one step above
    expect(deriveInstalmentPrice(50_000_000, rule)).toBe(58_000_000); // 57,500,000
    expect(deriveInstalmentPrice(11_848_462, rule)).toBe(13_700_000); // 13,625,731, step 100,000
    expect(deriveInstalmentPrice(1_500_000, rule)).toBe(1_730_000); // 1,725,000, step 10,000
    expect(deriveInstalmentPrice(10_000, rule)).toBe(12_000); // 11,500, step 1,000
    expect(deriveInstalmentPrice(0, rule)).toBe(0); // on request stays on request
  });

  it("is never below the markup and never more than 5 % above it", () => {
    for (let p = 1_000; p < 300_000_000; p = Math.ceil(p * 1.37) + 7) {
      const d = deriveInstalmentPrice(p, rule);
      expect(d).toBeGreaterThanOrEqual(p * 1.15 - 1e-6);
      expect(d).toBeLessThanOrEqual(p * 1.15 * 1.05 + 1_000);
    }
  });

  it("markupStep never exceeds roundTo", () => {
    expect(markupStep(500_000_000, 100_000)).toBe(100_000);
    expect(markupStep(74_000_000, 1_000_000)).toBe(1_000_000);
  });

  it("without a markup the commission rule applies unchanged", () => {
    expect(deriveInstalmentPrice(100_000_000, { commissionPercent: 10, roundTo: 10_000, markupPercent: null })).toBe(111_120_000);
    expect(instalmentsRule({ "commerce.installments": { commissionPercent: 10, roundTo: 10_000, markupPercent: null } })).toEqual({ commissionPercent: 10, roundTo: 10_000 });
    expect(instalmentsRule({ "commerce.installments": { commissionPercent: 10, roundTo: 1_000_000, markupPercent: 15 } })).toEqual(rule);
  });
});
