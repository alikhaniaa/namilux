import { describe, expect, it } from "vitest";

import { DEFAULT_LOYALTY_RULES } from "../../loyalty/rules";
import { pointsQuote, pointsToEarn, pointsToggleFa, redeemValue } from "../points";

const R = DEFAULT_LOYALTY_RULES; // value 1 000, cap 20 %, min 100, earnPerToman 10 000

describe("pricing/points", () => {
  it("balance 1200 / subtotal 6 000 000 → { points: 1200, value: 1 200 000 }", () => {
    expect(redeemValue(1200, 6_000_000, R)).toEqual({ points: 1200, value: 1_200_000 });
  });

  it("balance 1200 / subtotal 5 000 000 → cap 1000 and pointsQuote.capped true", () => {
    expect(redeemValue(1200, 5_000_000, R)).toEqual({ points: 1000, value: 1_000_000 });
    const q = pointsQuote({ balance: 1200, subtotal: 5_000_000, usePoints: true, couponStackable: true, rules: R });
    expect(q.used).toBe(1000);
    expect(q.capped).toBe(true);
  });

  it("balance 99 / subtotal 10 000 000 → { 0, 0 } (below minRedeem)", () => {
    expect(redeemValue(99, 10_000_000, R)).toEqual({ points: 0, value: 0 });
  });

  it("balance 150 / subtotal 400 000 → cap 80 < min → { 0, 0 } reason below_min", () => {
    expect(redeemValue(150, 400_000, R)).toEqual({ points: 0, value: 0 });
    const q = pointsQuote({ balance: 150, subtotal: 400_000, usePoints: true, couponStackable: true, rules: R });
    expect(q.used).toBe(0);
    expect(q.reason).toBe("below_min");
  });

  it("balance 0 or negative → { 0, 0 }", () => {
    expect(redeemValue(0, 10_000_000, R)).toEqual({ points: 0, value: 0 });
    expect(redeemValue(-5, 10_000_000, R)).toEqual({ points: 0, value: 0 });
  });

  it("rules.enabled false → { 0, 0 } and pointsToEarn 0", () => {
    const off = { ...R, enabled: false };
    expect(redeemValue(1200, 6_000_000, off)).toEqual({ points: 0, value: 0 });
    expect(pointsToEarn(41_500_000, off)).toBe(0);
  });

  it("pointsToEarn thresholds", () => {
    expect(pointsToEarn(41_500_000, R)).toBe(4150);
    expect(pointsToEarn(9_999, R)).toBe(0);
    expect(pointsToEarn(0, R)).toBe(0);
    expect(pointsToEarn(-5, R)).toBe(0);
  });

  it("pointsQuote couponStackable false → used 0, reason coupon_not_stackable, available reported", () => {
    const q = pointsQuote({ balance: 1200, subtotal: 6_000_000, usePoints: true, couponStackable: false, rules: R });
    expect(q).toMatchObject({ used: 0, reason: "coupon_not_stackable", available: 1200 });
  });

  it("pointsQuote usePoints false → used 0, reason not_requested", () => {
    const q = pointsQuote({ balance: 1200, subtotal: 6_000_000, usePoints: false, couponStackable: true, rules: R });
    expect(q).toMatchObject({ used: 0, reason: "not_requested", available: 1200 });
  });

  it("pointsToggleFa formats points and value", () => {
    expect(pointsToggleFa(1200, 1_200_000)).toBe("استفاده از ۱٬۲۰۰ امتیاز (۱٬۲۰۰٬۰۰۰ تومان)");
  });
});
