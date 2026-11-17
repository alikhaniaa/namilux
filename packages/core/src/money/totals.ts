import { appError } from "../errors";
import { MAX_CART_LINES } from "../constants";
import type { CouponEval, PricedLine, Totals, TotalsLine } from "../types/order";

export type ComputeTotalsInput = { lines: PricedLine[]; coupon?: CouponEval; pointsValue: number; shipping: number };

/** VALIDATION with the `{ field, productId? }` details shape of the contract. */
function invalid(field: string, productId?: number): never {
  const details: { field: string; productId?: number } = { field };
  if (productId !== undefined) details.productId = productId;
  throw appError("VALIDATION", { details });
}

/** Step 1 guard: safe non-negative integer Toman/qty - no floats, no NaN, no Infinity. */
function assertInt(n: unknown, field: string, min: number, productId?: number): number {
  if (typeof n !== "number") invalid(field, productId);
  if (!Number.isSafeInteger(n) || n < min) invalid(field, productId);
  return n;
}

/** Internal result of step 3 so step 6 knows whether a free_shipping coupon reached its minimum. */
type CouponApplication = { amount: number; minMet: boolean; freeShipping: boolean };

function applyCoupon(coupon: CouponEval | undefined, lines: readonly PricedLine[], subtotal: number): CouponApplication {
  if (!coupon) return { amount: 0, minMet: false, freeShipping: false };

  const eligible = coupon.eligibleProductIds;
  const eligibleSubtotal =
    eligible === "all"
      ? subtotal
      : (Array.isArray(eligible) ? eligible : []).length === 0
        ? 0
        : lines.reduce((sum, l) => (eligible.includes(l.productId) ? sum + l.unitPrice * l.qty : sum), 0);

  const minSubtotal = Number.isSafeInteger(coupon.minSubtotal) ? coupon.minSubtotal : 0;
  if (eligibleSubtotal < minSubtotal) return { amount: 0, minMet: false, freeShipping: false };

  if (coupon.kind === "free_shipping") return { amount: 0, minMet: true, freeShipping: true };

  const value = assertInt(coupon.value, "coupon.value", 0);
  const raw = coupon.kind === "percent" ? Math.floor((eligibleSubtotal * value) / 100) : value;
  const cap = coupon.maxDiscount === null || coupon.maxDiscount === undefined ? Number.POSITIVE_INFINITY : assertInt(coupon.maxDiscount, "coupon.maxDiscount", 0);

  return { amount: Math.max(0, Math.min(raw, cap, eligibleSubtotal)), minMet: true, freeShipping: false };
}

export function computeTotals(i: ComputeTotalsInput): Totals {
  if (!i || typeof i !== "object") invalid("input");
  const { lines, coupon } = i;

  // ---- 1. validate
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > MAX_CART_LINES) invalid("lines");
  const pointsValue = assertInt(i.pointsValue, "pointsValue", 0);
  const shippingInput = assertInt(i.shipping, "shipping", 0);

  const seen = new Set<number>();
  const totalsLines: TotalsLine[] = [];
  for (const line of lines) {
    if (!line || typeof line !== "object") invalid("lines");
    const productId = assertInt(line.productId, "lines.productId", 1);
    if (seen.has(productId)) invalid("lines.productId", productId);
    seen.add(productId);
    // A 0-price line is ON_REQUEST and must never reach here (the spec invariant 3).
    const unitPrice = assertInt(line.unitPrice, "lines.unitPrice", 1, productId);
    const qty = assertInt(line.qty, "lines.qty", 1, productId);
    const lineTotal = unitPrice * qty;
    if (!Number.isSafeInteger(lineTotal)) invalid("lines.lineTotal", productId);
    totalsLines.push({ productId, qty, unitPrice, lineTotal });
  }

  // ---- 2. subtotal
  const subtotal = totalsLines.reduce((sum, l) => sum + l.lineTotal, 0);
  if (!Number.isSafeInteger(subtotal)) invalid("subtotal");

  // ---- 3./4. coupon → discount
  const applied = applyCoupon(coupon, lines, subtotal);
  const couponAmount = applied.amount;
  const discount = couponAmount;

  // ---- 5. points (never push the remainder below 0; non-stackable coupons win)
  const stackBlocked = coupon !== undefined && coupon.stackableWithPoints === false && couponAmount > 0;
  const pointsDiscount = stackBlocked ? 0 : Math.max(0, Math.min(pointsValue, subtotal - discount));

  // ---- 6. shipping
  const freeShipping = applied.freeShipping;
  const shipping = freeShipping ? 0 : shippingInput;

  // ---- 7. grand total
  const grandTotal = subtotal - discount - pointsDiscount + shipping;

  const totals: Totals = { subtotal, couponAmount, discount, pointsDiscount, shipping, grandTotal, freeShipping, lines: totalsLines };
  assertTotalsInvariant(totals);
  return totals;
}

// DECISION: assertTotalsInvariant checks the spec invariant 1 (identity + every term ≥ 0) AND
// invariant 2 (lineTotal = unitPrice × qty, subtotal = Σ lineTotal) - both are properties of a
// Totals object, and the stricter check is the more secure reading of "the identity fails".
export function assertTotalsInvariant(t: Totals): void {
  const fail = (why: string): never => {
    throw appError("INTERNAL", { details: { invariant: why } });
  };
  if (!t || typeof t !== "object") fail("totals is not an object");
  const terms: (keyof Totals)[] = ["subtotal", "couponAmount", "discount", "pointsDiscount", "shipping", "grandTotal"];
  for (const term of terms) {
    const v = t[term] as unknown;
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) fail(`${String(term)} is not a non-negative integer`);
  }
  if (!Array.isArray(t.lines)) fail("lines is not an array");
  let sum = 0;
  for (const l of t.lines) {
    if (l.lineTotal !== l.unitPrice * l.qty) fail("lineTotal !== unitPrice × qty");
    sum += l.lineTotal;
  }
  if (sum !== t.subtotal) fail("subtotal !== Σ lineTotal");
  if (t.grandTotal !== t.subtotal - t.discount - t.pointsDiscount + t.shipping) fail("grandTotal identity");
}

export function couponAmountFor(coupon: CouponEval, lines: PricedLine[]): number {
  if (!Array.isArray(lines)) return 0;
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  return applyCoupon(coupon, lines, subtotal).amount;
}

/** compareAt > price > 0, both safe integers - the only definition of "on sale" in the money module. */
function saleCompareAt(price: number, compareAt: number | null | undefined): number | null {
  if (compareAt === null || compareAt === undefined) return null;
  if (!Number.isSafeInteger(price) || !Number.isSafeInteger(compareAt)) return null;
  return compareAt > price && price > 0 ? compareAt : null;
}

/** Badge percent: only a real sale and only a whole percent ≥ 1 (0 → null). */
export function percentOff(price: number, compareAt: number | null | undefined): number | null {
  const base = saleCompareAt(price, compareAt);
  if (base === null) return null;
  const pct = Math.floor(((base - price) / base) * 100);
  return pct > 0 ? pct : null;
}

export function savings(price: number, compareAt: number | null | undefined): number | null {
  const base = saleCompareAt(price, compareAt);
  return base === null ? null : base - price;
}

// DECISION: roundToman validates its input (safe non-negative integer, `to` ∈ {10 000, 100 000})
// and throws VALIDATION - bulk price is a sudo-gated write; silently rounding NaN would
// write a broken price. Half up: floor((n + to/2) / to) × to.
export function roundToman(n: number, to: 10_000 | 100_000): number {
  const value = assertInt(n, "n", 0);
  if (to !== 10_000 && to !== 100_000) invalid("to");
  return Math.floor((value + to / 2) / to) * to;
}
