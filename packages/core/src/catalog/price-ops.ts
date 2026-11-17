import { roundToman } from "../money/totals";

/**
 * Price arithmetic with no database behind it: the bulk service (bulk-price.ts) and the admin's
 * pricing screens both compute a new price from an old one, and a second copy of these rules is how
 * a preview and the write it promises drift apart. Pure, so the client subset may carry it.
 */

export type SkipReason = "on_request" | "negative" | "compare_below_price" | "fx_basis" | "unchanged";

export type PriceState = { price: number; compareAt: number | null };

export type BulkPriceOperation = {
  op: "percent" | "fixed" | "set" | "round";
  value: number;
  target: "price" | "compareAt" | "both";
  round: 10_000 | 100_000 | null;
};

/** Apply the operation to a single field value; result is a raw (un-rounded) integer/float. */
function applyToValue(v: number, o: BulkPriceOperation): number {
  switch (o.op) {
    case "percent":
      return v * (1 + o.value / 100);
    case "fixed":
      return v + o.value;
    case "set":
      return o.value;
    case "round":
      return roundToman(Math.max(0, Math.round(v)), o.round ?? 10_000);
  }
}

export function applyOperation(
  before: PriceState,
  o: BulkPriceOperation,
): { after: PriceState; saleEnded: boolean } | { skip: SkipReason } {
  const touchPrice = o.target === "price" || o.target === "both";
  const touchCompare = o.target === "compareAt" || o.target === "both";

  let newPrice = before.price;
  let newCompare = before.compareAt;

  if (touchPrice) {
    // rules: percent/fixed/round on price skip on-request rows; only `set` may mint a price.
    if (o.op !== "set" && before.price === 0) return { skip: "on_request" };
    newPrice = Math.round(applyToValue(before.price, o));
    if (newPrice < 0) return { skip: "negative" };
  }

  if (touchCompare) {
    if (before.compareAt === null) {
      // rules: percent/fixed/round → nothing to change; `set` creates the compare-at.
      if (o.op !== "set") {
        if (!touchPrice) return { skip: "unchanged" };
      } else {
        newCompare = Math.round(applyToValue(0, o));
      }
    } else {
      newCompare = Math.round(applyToValue(before.compareAt, o));
      if (newCompare < 0) return { skip: "negative" };
    }
  }

  // A price of zero is on-request, so it cannot retain a discount. Otherwise compareAt <= price
  // ends the sale when price is touched; a compare-only edit is refused instead.
  let saleEnded = false;
  if (newCompare !== null && (newPrice === 0 || newCompare <= newPrice)) {
    if (touchPrice) {
      newCompare = null;
      saleEnded = true;
    } else {
      return { skip: "compare_below_price" };
    }
  }

  if (newPrice === before.price && newCompare === before.compareAt) return { skip: "unchanged" };
  return { after: { price: newPrice, compareAt: newCompare }, saleEnded };
}

/**
 * Several operations in a row - «۵٪ گران‌تر، بعد گرد به ۱۰٬۰۰۰». A step that changes nothing passes
 * the row on untouched; any other skip ends the plan, because the next step would be computed from
 * a price the first one refused to produce.
 */
export function planPrice(
  before: PriceState,
  steps: readonly BulkPriceOperation[],
): { after: PriceState; saleEnded: boolean } | { skip: SkipReason } {
  let state = before;
  let saleEnded = false;
  for (const step of steps) {
    const r = applyOperation(state, step);
    if ("skip" in r) {
      if (r.skip === "unchanged") continue;
      return r;
    }
    state = r.after;
    saleEnded ||= r.saleEnded;
  }
  if (state.price === before.price && state.compareAt === before.compareAt) return { skip: "unchanged" };
  return { after: state, saleEnded };
}

/**
 * A price typed by hand, next to the «قبل از تخفیف» price the row already has. The stored rule is
 * `compareAt > price > 0`; a new price at or above the old struck-through one is not a mistake to
 * refuse - the discount is simply over, so it is dropped and reported.
 */
export function typedPrice(before: PriceState, price: number): { after: PriceState; saleEnded: boolean } {
  const keeps = before.compareAt !== null && price > 0 && before.compareAt > price;
  return { after: { price, compareAt: keeps ? before.compareAt : null }, saleEnded: before.compareAt !== null && !keeps };
}

/** At or beyond this ratio a typed price is far more often a dropped or doubled zero than a real change. */
export const PRICE_JUMP_RATIO = 3;

/** «×۱۰» / «÷۱۰»-shaped edits: the caller asks once more before writing them. */
export function isPriceJump(before: number, after: number): boolean {
  if (before <= 0 || after <= 0) return false;
  return after >= before * PRICE_JUMP_RATIO || after * PRICE_JUMP_RATIO <= before;
}

/** The change as a whole percent, or null when there is no earlier price to compare with. */
export function priceChangePercent(before: number, after: number): number | null {
  if (before <= 0 || after <= 0) return null;
  return Math.round(((after - before) / before) * 100);
}
