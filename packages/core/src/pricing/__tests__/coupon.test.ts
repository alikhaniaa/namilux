import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, withTestTx } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import type { CouponEvalCtx, CouponLineMeta, CouponRow } from "../coupon";
import {
  COUPON_FA,
  couponFailFa,
  evaluateCoupon,
  evaluateCouponRules,
  normalizeCouponCode,
  resolveEligible,
} from "../coupon";
import { computeTotals } from "../../money/totals";
import type { CouponEval, PricedLine } from "../../types/order";

const NOW = new Date("2026-08-27T00:00:00.000Z");

function meta(productId: number, over: Partial<CouponLineMeta> = {}): CouponLineMeta {
  return { productId, unitPrice: 10_000_000, qty: 1, brandId: null, categoryIds: [], collectionIds: [], ...over };
}

function mk(over: Partial<CouponRow>): CouponRow {
  return {
    id: 1,
    code: "WELCOME",
    kind: "percent",
    value: 10,
    minSubtotal: 0,
    maxDiscount: null,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    usagePerCustomer: 1,
    firstOrderOnly: false,
    customerId: null,
    applies: {},
    excludes: {},
    stackableWithPoints: true,
    isActive: true,
    ...over,
  };
}

function ctx(over: Partial<CouponEvalCtx> = {}): CouponEvalCtx {
  return {
    eligibleProductIds: "all",
    eligibleSubtotal: 10_000_000,
    now: NOW,
    totalRedemptions: 0,
    customerRedemptions: 0,
    customerPaidOrders: 0,
    ...over,
  };
}

/** The amount the coupon yields is computed by money/totals.ts, so tie the eval into computeTotals. */
function amountOf(evalResult: CouponEval, lines: PricedLine[]): number {
  return computeTotals({ lines, coupon: evalResult, pointsValue: 0, shipping: 0 }).couponAmount;
}

const ONE_LINE: PricedLine[] = [{ productId: 1, unitPrice: 10_000_000, qty: 1, compareAt: null }];

describe("pricing/coupon - rules table", () => {
  it("percent 10 without limits → amount 1 000 000", () => {
    const r = evaluateCouponRules(mk({}), ctx()) as CouponEval;
    expect(r).toMatchObject({ kind: "percent", value: 10, eligibleProductIds: "all" });
    expect(amountOf(r, ONE_LINE)).toBe(1_000_000);
  });
  it("percent 10 with maxDiscount 500 000 → amount 500 000", () => {
    const r = evaluateCouponRules(mk({ maxDiscount: 500_000 }), ctx()) as CouponEval;
    expect(amountOf(r, ONE_LINE)).toBe(500_000);
  });
  it("fixed 15 000 000 → amount 10 000 000 (capped at eligible)", () => {
    const r = evaluateCouponRules(mk({ kind: "fixed", value: 15_000_000 }), ctx()) as CouponEval;
    expect(amountOf(r, ONE_LINE)).toBe(10_000_000);
  });
  it("free_shipping → amount 0 with kind free_shipping", () => {
    const r = evaluateCouponRules(mk({ kind: "free_shipping", value: 0 }), ctx()) as CouponEval;
    expect(r.kind).toBe("free_shipping");
    expect(amountOf(r, ONE_LINE)).toBe(0);
  });
  it("isActive false → inactive", () => {
    expect(evaluateCouponRules(mk({ isActive: false }), ctx())).toMatchObject({ error: "COUPON_INVALID", reason: "inactive" });
  });
  it("startsAt tomorrow → not_started", () => {
    expect(evaluateCouponRules(mk({ startsAt: new Date("2026-08-28T00:00:00Z") }), ctx())).toMatchObject({ reason: "not_started" });
  });
  it("endsAt yesterday → expired", () => {
    expect(evaluateCouponRules(mk({ endsAt: new Date("2026-08-26T00:00:00Z") }), ctx())).toMatchObject({ reason: "expired" });
  });
  it("minSubtotal 20 000 000 → min_subtotal and fa contains '۲۰٬۰۰۰٬۰۰۰'", () => {
    const r = evaluateCouponRules(mk({ minSubtotal: 20_000_000 }), ctx());
    expect(r).toMatchObject({ reason: "min_subtotal" });
    expect((r as { fa: string }).fa).toContain("۲۰٬۰۰۰٬۰۰۰");
  });
  it("no eligible products (empty list) → scope", () => {
    expect(evaluateCouponRules(mk({ applies: { brandIds: [24] } }), ctx({ eligibleProductIds: [], eligibleSubtotal: 0 }))).toMatchObject({ reason: "scope" });
  });
  it("usageLimit 100 with totalRedemptions 100 → usage_limit; 99 → ok", () => {
    expect(evaluateCouponRules(mk({ usageLimit: 100 }), ctx({ totalRedemptions: 100 }))).toMatchObject({ reason: "usage_limit" });
    expect(evaluateCouponRules(mk({ usageLimit: 100 }), ctx({ totalRedemptions: 99 }))).toMatchObject({ value: 10 });
  });
  it("usagePerCustomer 1 with customerRedemptions 1 → per_customer", () => {
    expect(evaluateCouponRules(mk({ usagePerCustomer: 1 }), ctx({ customerRedemptions: 1 }))).toMatchObject({ reason: "per_customer" });
  });
  it("firstOrderOnly with customerPaidOrders 1 → first_order_only; 0 → ok", () => {
    expect(evaluateCouponRules(mk({ firstOrderOnly: true }), ctx({ customerPaidOrders: 1 }))).toMatchObject({ reason: "first_order_only" });
    expect(evaluateCouponRules(mk({ firstOrderOnly: true }), ctx({ customerPaidOrders: 0 }))).toMatchObject({ value: 10 });
  });
  it("personal coupon with another / no customerId → personal", () => {
    expect(evaluateCouponRules(mk({ customerId: "01JA" }), ctx({ customerId: "01JB" }))).toMatchObject({ reason: "personal" });
    expect(evaluateCouponRules(mk({ customerId: "01JA" }), ctx())).toMatchObject({ reason: "personal" });
  });
  it("order of checks: inactive+expired → inactive; expired+min_subtotal → expired", () => {
    expect(evaluateCouponRules(mk({ isActive: false, endsAt: new Date("2020-01-01Z") }), ctx())).toMatchObject({ reason: "inactive" });
    expect(evaluateCouponRules(mk({ endsAt: new Date("2020-01-01Z"), minSubtotal: 99_000_000 }), ctx())).toMatchObject({ reason: "expired" });
  });
  it("every failure carries COUPON_INVALID and the exact copy", () => {
    const r = evaluateCouponRules(mk({ isActive: false }), ctx()) as { error: string; fa: string };
    expect(r.error).toBe("COUPON_INVALID");
    expect(r.fa).toBe(COUPON_FA.inactive);
  });
});

describe("pricing/coupon - helpers", () => {
  it("normalizeCouponCode folds, strips and validates", () => {
    expect(normalizeCouponCode(" nl-Welcome 10 ")).toBe("NLWELCOME10");
    expect(normalizeCouponCode("۱۲۳")).toBe("123");
    expect(normalizeCouponCode("ab")).toBe("");
    expect(normalizeCouponCode("A".repeat(33))).toBe("");
  });
  it("couponFailFa min_subtotal formats the amount", () => {
    expect(couponFailFa("min_subtotal", 5_000_000)).toBe("حداقل سبد برای این کد ۵٬۰۰۰٬۰۰۰ تومان است");
  });
  it("resolveEligible: empty scopes → 'all'; excludes remove; brand scope narrows", () => {
    const lines = [meta(1, { brandId: 24 }), meta(2, { brandId: 52 })];
    expect(resolveEligible(lines, {}, {})).toEqual({ productIds: "all", subtotal: 20_000_000 });
    expect(resolveEligible(lines, {}, { brandIds: [52] })).toEqual({ productIds: [1], subtotal: 10_000_000 });
    expect(resolveEligible(lines, { brandIds: [24] }, {})).toEqual({ productIds: [1], subtotal: 10_000_000 });
  });
  it("resolveEligible: brand applies with product excludes leaves only the other product", () => {
    const lines = [meta(1044, { brandId: 24 }), meta(2001, { brandId: 24 })];
    expect(resolveEligible(lines, { brandIds: [24] }, { productIds: [1044] })).toEqual({ productIds: [2001], subtotal: 10_000_000 });
  });
});

describe.skipIf(!hasTestDb())("pricing/coupon — integration", () => {
  let handle: TestDb;
  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterAll(async () => {
    await handle.close();
  });

  it("unknown code → { error: COUPON_INVALID, reason: unknown }", async () => {
    await withTestTx(handle.db, async (tx) => {
      const r = await evaluateCoupon(tx, "NOSUCHCODE", { lines: ONE_LINE, phone: "09121110000" });
      expect(r).toMatchObject({ error: "COUPON_INVALID", reason: "unknown" });
    });
  });

  it("empty/invalid code short-circuits to unknown without a query", async () => {
    await withTestTx(handle.db, async (tx) => {
      expect(await evaluateCoupon(tx, "ab", { lines: [], phone: "09121110000" })).toMatchObject({ reason: "unknown" });
    });
  });
});
