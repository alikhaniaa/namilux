import { describe, expect, it } from "vitest";
import * as client from "../../client";
import { formatTehranTime, tehranDayKey } from "../../persian";
import { PRICE_JUMP_RATIO, isPriceJump, planPrice, priceChangePercent, typedPrice } from "../price-ops";
import type { BulkPriceOperation } from "../price-ops";
import { priceSheetSchema } from "../../validation/price-sheet";

const percent = (value: number, target: BulkPriceOperation["target"] = "price"): BulkPriceOperation => ({ op: "percent", value, target, round: null });
const round = (to: 10_000 | 100_000, target: BulkPriceOperation["target"] = "price"): BulkPriceOperation => ({ op: "round", value: 0, target, round: to });

describe("catalog/price-ops - planPrice", () => {
  it("applies the steps in order: a rise, then the rounding of the risen price", () => {
    expect(planPrice({ price: 36_622_445, compareAt: null }, [percent(5), round(10_000)])).toEqual({
      after: { price: 38_450_000, compareAt: null },
      saleEnded: false,
    });
  });

  it("carries a row past a step that changes nothing instead of dropping it", () => {
    // +0.001 % rounds back to the same Toman; the rounding step still has work to do
    expect(planPrice({ price: 1_234_567, compareAt: null }, [percent(0.001), round(10_000)])).toEqual({
      after: { price: 1_230_000, compareAt: null },
      saleEnded: false,
    });
  });

  it("is unchanged when every step leaves the price where it was", () => {
    expect(planPrice({ price: 1_230_000, compareAt: null }, [round(10_000)])).toEqual({ skip: "unchanged" });
    expect(planPrice({ price: 1_230_000, compareAt: null }, [])).toEqual({ skip: "unchanged" });
  });

  it("stops at the first real refusal", () => {
    expect(planPrice({ price: 0, compareAt: null }, [percent(5), round(10_000)])).toEqual({ skip: "on_request" });
    expect(planPrice({ price: 100_000, compareAt: null }, [{ op: "fixed", value: -200_000, target: "price", round: null }])).toEqual({ skip: "negative" });
  });

  it("moves the «قبل از تخفیف» price with the selling price when asked to, and reports a sale that ended", () => {
    expect(planPrice({ price: 1_000_000, compareAt: 1_200_000 }, [percent(10, "both")])).toEqual({
      after: { price: 1_100_000, compareAt: 1_320_000 },
      saleEnded: false,
    });
    expect(planPrice({ price: 1_000_000, compareAt: 1_200_000 }, [percent(30)])).toEqual({
      after: { price: 1_300_000, compareAt: null },
      saleEnded: true,
    });
  });

  it.each([
    { before: { price: 100_000, compareAt: 200_000 }, steps: [{ op: "fixed", value: -100_000, target: "both", round: null }] },
    { before: { price: 100_000, compareAt: 200_000 }, steps: [{ op: "fixed", value: -100_000, target: "price", round: null }] },
    { before: { price: 4_000, compareAt: 10_000 }, steps: [round(10_000, "both")] },
  ] satisfies { before: { price: number; compareAt: number }; steps: BulkPriceOperation[] }[])("keeps an on-request result saveable when a group change removes its price: $before", ({ before, steps }) => {
    const result = planPrice(before, steps);
    expect(result).toEqual({ after: { price: 0, compareAt: null }, saleEnded: true });
    if ("skip" in result) throw new Error("Expected a saveable group price change");
    expect(priceSheetSchema.safeParse({ rows: [{
      id: 1,
      before: { price: before.price, compareAtPrice: before.compareAt },
      after: { price: result.after.price, compareAtPrice: result.after.compareAt },
    }] }).success).toBe(true);
  });
});

describe("catalog/price-ops - a price typed by hand", () => {
  it("keeps the discount while the old price is still above the new one", () => {
    expect(typedPrice({ price: 1_000_000, compareAt: 1_200_000 }, 1_100_000)).toEqual({ after: { price: 1_100_000, compareAt: 1_200_000 }, saleEnded: false });
  });

  it("ends the discount when the new price reaches or passes the old one, or becomes on-request", () => {
    for (const price of [1_200_000, 1_500_000, 0]) {
      expect(typedPrice({ price: 1_000_000, compareAt: 1_200_000 }, price)).toEqual({ after: { price, compareAt: null }, saleEnded: true });
    }
  });

  it("has nothing to end on a product with no discount", () => {
    expect(typedPrice({ price: 1_000_000, compareAt: null }, 2_000_000)).toEqual({ after: { price: 2_000_000, compareAt: null }, saleEnded: false });
  });

  it("flags a dropped or doubled zero, and nothing an ordinary repricing would do", () => {
    expect(PRICE_JUMP_RATIO).toBe(3);
    expect(isPriceJump(12_500_000, 125_000_000)).toBe(true);
    expect(isPriceJump(12_500_000, 1_250_000)).toBe(true);
    expect(isPriceJump(12_500_000, 37_500_000)).toBe(true);
    expect(isPriceJump(12_500_000, 4_166_666)).toBe(true);
    for (const next of [12_500_000, 13_900_000, 24_000_000, 37_499_999, 4_200_000]) expect(isPriceJump(12_500_000, next)).toBe(false);
    // a first price, or a product going on request, has nothing to be compared with
    expect(isPriceJump(0, 99_000_000)).toBe(false);
    expect(isPriceJump(99_000_000, 0)).toBe(false);
  });

  it("puts a change into whole per cent", () => {
    expect(priceChangePercent(1_000_000, 1_050_000)).toBe(5);
    expect(priceChangePercent(1_000_000, 900_000)).toBe(-10);
    expect(priceChangePercent(0, 900_000)).toBeNull();
    expect(priceChangePercent(900_000, 0)).toBeNull();
  });

  it("is reachable from the client barrel, where the admin's price screens import it", () => {
    const bag = client as Record<string, unknown>;
    for (const name of ["applyOperation", "planPrice", "typedPrice", "isPriceJump", "priceChangePercent", "PRICE_EDIT_MAX", "PRICE_SHEET_MAX", "priceEditSchema"]) {
      expect(bag[name], name).toBeDefined();
    }
  });
});

describe("persian/format - the shop's day and clock", () => {
  it("keys an instant by its Tehran calendar day (UTC+03:30)", () => {
    expect(tehranDayKey("2026-10-01T20:29:59Z")).toBe("2026-10-01");
    // 20:30 UTC is midnight in Tehran
    expect(tehranDayKey("2026-10-01T20:30:00Z")).toBe("2026-10-02");
    expect(tehranDayKey(Date.parse("2026-10-01T00:00:00Z"))).toBe("2026-10-01");
    expect(tehranDayKey("nope")).toBe("");
  });

  it("prints the Tehran time in Persian digits on a 24-hour clock", () => {
    expect(formatTehranTime("2026-10-01T05:36:00Z")).toBe("۰۹:۰۶");
    expect(formatTehranTime("2026-10-01T20:30:00Z")).toBe("۰۰:۰۰");
    expect(formatTehranTime("nope")).toBe("");
  });
});
