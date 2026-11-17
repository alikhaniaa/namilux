import type { SalesChannel } from "../channel";
import { appError } from "../errors";

/**
 * The per-product instalment switch (products.instalment_eligible), as a rule.
 *
 * An instalment purchase is a basket paid through SnappPay on the instalment storefront. The admin
 * may switch any product off for it; the rule for a basket is ALL-OR-NOTHING - one ineligible
 * product makes the whole basket ineligible, and the answer names every product that blocks it so
 * the shopper can remove exactly those. Card purchase (the main storefront, ZarinPal) never reads
 * the switch, so an ineligible product is still bought there as before.
 *
 * Enforced on the server at every point money can move: the quote (the line is removed with the
 * reason below), placeOrder (re-checked on the rows it locks FOR UPDATE, so neither a stale quote
 * nor a hand-written request gets past it), retryPayment (a pending instalment order whose product
 * was switched off since cannot be re-sent to the gateway) and the checkout eligibility endpoint.
 */

/** The reason carried by the quote warning and by the CONFLICT error's `details.reason`. */
export const INSTALMENT_INELIGIBLE = "instalment_ineligible" as const;

export const INSTALMENT_INELIGIBLE_FA = "خرید اقساطی برای برخی از کالاهای سبد شما فعال نیست. آن‌ها را از سبد حذف کنید یا نقدی خرید کنید.";

/** What the CONFLICT error carries in `details`. `productIds` is sorted ascending and deduped. */
export type InstalmentIneligibleDetails = { reason: typeof INSTALMENT_INELIGIBLE; productIds: number[] };

/** Is this product purchasable on this channel as far as the instalment switch is concerned? */
export function isInstalmentPurchasable(p: { instalmentEligible: boolean }, channel: SalesChannel): boolean {
  return channel !== "instalments" || p.instalmentEligible;
}

/** The ids of every product in the set that blocks an instalment purchase (sorted, deduped). */
export function instalmentBlockers(products: readonly { id: number; instalmentEligible: boolean }[]): number[] {
  return [...new Set(products.filter((p) => !p.instalmentEligible).map((p) => p.id))].sort((a, b) => a - b);
}

/** Throws CONFLICT `{ reason: "instalment_ineligible", productIds }` when any product blocks. */
export function assertInstalmentEligible(products: readonly { id: number; instalmentEligible: boolean }[]): void {
  const productIds = instalmentBlockers(products);
  if (productIds.length === 0) return;
  const details: InstalmentIneligibleDetails = { reason: INSTALMENT_INELIGIBLE, productIds };
  throw appError("CONFLICT", { fa: INSTALMENT_INELIGIBLE_FA, details });
}
