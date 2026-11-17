/**
 * The instalment storefront's price rule.
 *
 * SnappPay takes a commission from the MERCHANT, so the instalment site cannot show the fixed price
 * and still clear the same amount. The listed price is therefore grossed up by the commission and
 * rounded UP to a presentable step - never down, because rounding down would eat the margin the
 * gross-up just bought.
 */
export type InstalmentsRule = {
  /** SnappPay's merchant commission, in percent (0–60; the panel default is 10). */
  commissionPercent: number;
  /** Presentation step in Toman: 1,000 / 10,000 / 100,000 / 1,000,000. */
  roundTo: number;
  /**
   * When set, the instalment price is the fixed price plus this many percent (the owner's rule since
   * 15 Sep 2026: +15 %), and `commissionPercent` is not used. Rounded up with `markupStep`.
   */
  markupPercent?: number | null;
};

/** The presentation steps the panel offers for `roundTo`. */
export const INSTALMENT_ROUND_STEPS = [1_000, 10_000, 100_000, 1_000_000] as const;
export type InstalmentRoundStep = (typeof INSTALMENT_ROUND_STEPS)[number];

/** What `settings["commerce.installments"]` carries before the panel is ever touched. */
export const DEFAULT_INSTALMENTS_RULE = {
  commissionPercent: 10,
  roundTo: 10_000,
} as const satisfies InstalmentsRule;

/**
 * Pull the rule out of a loaded settings object. Structural on purpose: it costs the pricing module
 * no import of the settings schema (and therefore no cycle), and any caller already holding the
 * settings can hand them straight over.
 */
export function instalmentsRule(settings: {
  "commerce.installments": { commissionPercent: number; roundTo: number; markupPercent?: number | null };
}): InstalmentsRule {
  const s = settings["commerce.installments"];
  return {
    commissionPercent: s.commissionPercent,
    roundTo: s.roundTo,
    ...(typeof s.markupPercent === "number" ? { markupPercent: s.markupPercent } : {}),
  };
}

/**
 * The rounding step for a marked-up price: the largest panel step that is not above `roundTo` and not
 * above a twentieth of the amount, so rounding never adds more than 5 %. With `roundTo` 1,000,000:
 * 74,123,123 becomes 75,000,000, but 1,725,000 becomes 1,730,000 rather than 2,000,000.
 */
export function markupStep(amount: number, roundTo: number): number {
  let step: number = INSTALMENT_ROUND_STEPS[0];
  for (const s of INSTALMENT_ROUND_STEPS) if (s <= roundTo && s * 20 <= amount) step = s;
  return step;
}

/**
 * price → the instalment site's price, in whole Toman.
 *
 *   ceil( price / (1 - commission/100) / roundTo ) * roundTo
 *
 * A price of 0 is "on request" (the same meaning it has on the main site) and stays 0 - the
 * gross-up must never invent a price for a product that has none.
 */
export function deriveInstalmentPrice(price: number, rule: InstalmentsRule): number {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const markup = rule.markupPercent;
  if (typeof markup === "number" && Number.isFinite(markup) && markup >= 0) {
    // price × (100 + markup) is an exact integer for a whole-Toman price and a whole percentage, and a
    // quotient that is really an integer divides exactly, so 100,000,000 lands on 115,000,000 and never
    // one step above it.
    const scaled = price * (100 + markup);
    const step = markupStep(scaled / 100, rule.roundTo > 0 ? rule.roundTo : INSTALMENT_ROUND_STEPS[0]);
    return Math.ceil(scaled / (100 * step)) * step;
  }
  const step = rule.roundTo > 0 ? rule.roundTo : 1;
  const divisor = 1 - rule.commissionPercent / 100;
  // A commission of 100 % or more has no gross-up; refuse to divide by zero or flip the sign.
  if (!(divisor > 0)) return 0;
  return Math.ceil(price / divisor / step) * step;
}

/**
 * The price the instalment storefront actually shows for one product: the pinned value when a human
 * pinned it, the derived one otherwise. A pinned-but-empty value reads as 0 - on request.
 */
export function resolveInstalmentPrice(
  p: { price: number; instalmentPrice: number | null; instalmentPriceManual: boolean },
  rule: InstalmentsRule,
): number {
  return p.instalmentPriceManual ? (p.instalmentPrice ?? 0) : deriveInstalmentPrice(p.price, rule);
}
