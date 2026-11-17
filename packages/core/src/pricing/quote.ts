import { type Db, customers, eq } from "@namilux/db";
import type { Env } from "@namilux/config";
import type { SalesChannel } from "../channel";
import { addresses } from "../customers/addresses";
import { appError } from "../errors";
import { couponAmountFor } from "../money/totals";
import { loadProductsForQuote, listActiveShippingMethods } from "../inventory/repo";
import type { CouponEval, QuoteCoupon } from "../types";
import type { Settings } from "../settings/schema";
import { evaluateCoupon } from "./coupon";
import { isInstalmentPurchasable } from "./instalment-eligibility";
import { instalmentsRule, resolveInstalmentPrice } from "./instalments";
import type { InstalmentsRule } from "./instalments";
import { pointsQuote } from "./points";
import { cheapestOption, provinceCode, shippingOptions } from "./shipping";
import { quoteExpiresAt, signQuote } from "./sign";
// DECISION (M0 step 3): the quote shapes of the spec are declared once in ../types, and the ONE
// arithmetic `computeTotals` is owned by ../money/totals.ts - the spec lists it under "pricing", but
// money/ is the namespace whose entire contract is that function, it already types itself from
// ../types/order, and it is the copy re-exported by src/client.ts. This module consumes both.
import type {
  PricedLine,
  Quote,
  QuoteLine,
  QuoteLineStatus,
  QuoteRequest,
  QuoteWarning,
  Totals,
} from "../types";
import { computeTotals } from "../money/totals";

export type { PricedLine, Quote, QuoteLine, QuoteLineStatus, QuoteRequest, QuoteWarning, Totals };
export { computeTotals };

export const MAX_LINES = 20;
export const MIN_GRAND_TOTAL = 1_000;

export type QuoteLineReason =
  | "on_request"
  | "archived"
  | "hidden"
  | "draft"
  | "unknown"
  | "out_of_stock"
  | "max_per_order"
  | "stock"
  | "instalment_ineligible";

export type QuoteWarningCode =
  | "line.removed"
  | "line.qty_reduced"
  | "line.price_changed"
  | "coupon.invalid"
  | "points.capped"
  | "points.not_stackable"
  | "shipping.unavailable"
  | "shipping.estimated"
  | "total.below_min";

export type QuoteProduct = {
  id: number;
  name: string;
  displayName: string;
  slug: string;
  price: number;
  compareAt: number | null;
  instalmentPrice: number | null;
  instalmentPriceManual: boolean;
  /** The admin's per-product instalment switch (products.instalment_eligible). */
  instalmentEligible: boolean;
  status: "draft" | "active" | "archived";
  visibility: "public" | "hidden" | "link_only";
  stockPolicy: "track" | "untracked";
  stockQty: number;
  reserved: number;
  allowBackorder: boolean;
  maxPerOrder: number;
  lowStockThreshold: number;
  brandId: number | null;
  categoryIds: number[];
  collectionIds: number[];
  imageKey: string | null;
  sku: string | null;
  modelCode: string | null;
  colorName: string | null;
  warrantyMonths: number | null;
};

export function dedupeLines(lines: QuoteRequest["lines"]): { productId: number; qty: number }[] {
  const totals = new Map<number, number>();
  const order: number[] = [];
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty < 1) throw appError("VALIDATION", { fa: "تعداد نامعتبر است" });
    if (!totals.has(l.productId)) order.push(l.productId);
    totals.set(l.productId, (totals.get(l.productId) ?? 0) + l.qty);
  }
  if (order.length > MAX_LINES) throw appError("VALIDATION", { fa: "حداکثر ۲۰ کالا در هر سفارش" });
  return order.map((id) => ({ productId: id, qty: totals.get(id) ?? 0 }));
}

export function availableOf(p: QuoteProduct): number {
  if (p.stockPolicy === "untracked") return Number.MAX_SAFE_INTEGER;
  return Math.max(p.stockQty - p.reserved, 0);
}

// The real QuoteLine (../types) carries no slug/reason/requestedQty/maxPerOrder; the removal reason
// lives on the QuoteWarning union instead (kind:"removed"). Only public removed products retain details.
function removedLine(productId: number, name: string, image: string | null, unitPrice: number): QuoteLine {
  return { productId, name, image, unitPrice, qty: 0, lineTotal: 0, available: 0, status: "removed" };
}

/**
 * The unit price for one channel. On the main site it is the fixed price; on the instalment site it
 * is the derived (or pinned) one - and a product whose resolved price is 0 is "on request" there for
 * exactly the same reason a price of 0 is on the main site.
 */
export function unitPriceFor(p: QuoteProduct, channel: SalesChannel, rule: InstalmentsRule): number {
  return channel === "instalments" ? resolveInstalmentPrice(p, rule) : p.price;
}

export function buildQuoteLines(
  req: { productId: number; qty: number }[],
  products: QuoteProduct[],
  globalMaxPerOrder: number,
  channel: SalesChannel,
  rule: InstalmentsRule,
): { lines: QuoteLine[]; warnings: QuoteWarning[] } {
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines: QuoteLine[] = [];
  const warnings: QuoteWarning[] = [];
  for (const r of req) {
    const p = byId.get(r.productId);
    if (p === undefined) {
      // DECISION: the real "removed" reason union has no "unknown"/"draft"; an id that no longer
      //           resolves is reported as "archived" (the nearest gone-from-catalogue reason).
      warnings.push({ kind: "removed", productId: r.productId, reason: "archived" });
      lines.push(removedLine(r.productId, "", null, 0));
      continue;
    }
    const unitPrice = unitPriceFor(p, channel, rule);
    const remove = (reason: "on_request" | "archived" | "hidden" | "out_of_stock" | "instalment_ineligible"): void => {
      warnings.push({ kind: "removed", productId: p.id, reason });
      const privateProduct = reason === "archived" || reason === "hidden";
      lines.push(removedLine(p.id, privateProduct ? "" : p.displayName, privateProduct ? null : p.imageKey, privateProduct ? 0 : unitPrice));
    };
    if (p.status === "archived") {
      remove("archived");
    } else if (p.status === "draft" || p.visibility === "hidden") {
      remove("hidden"); // draft is not publicly buyable → the "hidden" reason
    } else if (unitPrice === 0) {
      remove("on_request");
    } else if (!isInstalmentPurchasable(p, channel)) {
      // The instalment site's only gateway is SnappPay, so a product the admin switched off for
      // instalments cannot be bought HERE at all - it drops out of this quote with its own reason
      // (the shopper can still buy it by card on the main site, which never reads the switch).
      // Removing it, rather than pricing it, is what keeps a mixed basket from ever reaching the
      // gateway: placeOrder refuses any removed line.
      remove("instalment_ineligible");
    } else {
      const avail = availableOf(p);
      const tracked = p.stockPolicy === "track" && !p.allowBackorder;
      if (tracked && avail <= 0) {
        remove("out_of_stock");
        continue;
      }
      const maxPer = Math.min(p.maxPerOrder, globalMaxPerOrder);
      let qty = r.qty;
      let status: QuoteLineStatus = "ok";
      if (tracked && qty > avail) {
        warnings.push({ kind: "qty_reduced", productId: p.id, from: qty, to: avail, reason: "stock" });
        qty = avail;
        status = "qty_reduced";
      }
      if (qty > maxPer) {
        warnings.push({ kind: "qty_reduced", productId: p.id, from: qty, to: maxPer, reason: "max_per_order" });
        qty = maxPer;
        status = "qty_reduced";
      }
      const line: QuoteLine = {
        productId: p.id,
        name: p.displayName,
        image: p.imageKey,
        unitPrice,
        qty,
        lineTotal: unitPrice * qty,
        available: Math.min(avail, maxPer), // never expose raw stock counts
        status,
      };
      // A "was" price only makes sense next to the price it is compared with: the instalment site
      // lists its own amount, so the main site's compare-at is not shown there.
      if (channel === "main" && p.compareAt !== null) line.compareAt = p.compareAt;
      lines.push(line);
    }
  }
  return { lines, warnings };
}

export function toPricedLines(lines: QuoteLine[], products: QuoteProduct[]): PricedLine[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  return lines
    .filter((l) => l.status === "ok" || l.status === "qty_reduced")
    // `compareAt` stays the CATALOGUE fact (was it on sale), which is what coupon eligibility asks - 
    // the same answer on both storefronts. Only the unit price is per-channel.
    .map((l) => ({ productId: l.productId, unitPrice: l.unitPrice, qty: l.qty, compareAt: byId.get(l.productId)?.compareAt ?? null }));
}

async function pointsBalanceOf(db: Db, customerId: string): Promise<number> {
  const rows = await db.select({ b: customers.pointsBalance }).from(customers).where(eq(customers.id, customerId)).limit(1);
  return rows[0]?.b ?? 0;
}

/**
 * `channel` is a REQUIRED ctx field, not a request field: which storefront is asking is a fact about
 * the SERVER (the site instance), never something a client may claim - and it is signed into the
 * quote, so a basket priced on one site cannot be placed on the other.
 */
export async function quote(
  db: Db,
  req: QuoteRequest,
  ctx: { customerId?: string; phone?: string; settings: Settings; env: Env; channel: SalesChannel; lockCoupon?: boolean },
): Promise<Quote> {
  const deduped = dedupeLines(req.lines);
  const products = deduped.length > 0 ? await loadProductsForQuote(db, deduped.map((l) => l.productId), { lock: "none" }) : [];
  const rule = instalmentsRule(ctx.settings);
  const { lines, warnings } = buildQuoteLines(deduped, products, ctx.settings["commerce.max_per_order"], ctx.channel, rule);
  const priced = toPricedLines(lines, products);
  const subtotal = priced.reduce((s, l) => s + l.unitPrice * l.qty, 0);

  // ---- coupon
  let couponEval: CouponEval | undefined;
  let couponField: QuoteCoupon | undefined;
  if (req.couponCode !== undefined && req.couponCode !== "") {
    if (ctx.phone === undefined) {
      couponField = { error: "UNAUTHORIZED" };
      warnings.push({ kind: "coupon_not_applied", code: req.couponCode, error: "UNAUTHORIZED" });
    } else {
      const result = await evaluateCoupon(db, req.couponCode, {
        lines: priced,
        phone: ctx.phone,
        ...(ctx.customerId !== undefined ? { customerId: ctx.customerId } : {}),
      }, { lock: ctx.lockCoupon === true });
      if ("error" in result) {
        couponField = { error: result.error };
        warnings.push({ kind: "coupon_not_applied", code: req.couponCode, error: result.error });
      } else {
        couponEval = result;
      }
    }
  }
  const couponAmount = couponEval !== undefined ? couponAmountFor(couponEval, priced) : 0;

  // ---- points
  let pointsField: Quote["points"];
  let pointsValue = 0;
  if (ctx.customerId !== undefined) {
    const balance = await pointsBalanceOf(db, ctx.customerId);
    const pq = pointsQuote({
      balance,
      subtotal: subtotal - couponAmount,
      usePoints: req.usePoints === true,
      couponStackable: couponEval !== undefined ? couponEval.stackableWithPoints : true,
      rules: ctx.settings["loyalty.rules"],
    });
    pointsField = { available: pq.available, used: pq.used, value: pq.value };
    pointsValue = pq.value;
    if (pq.capped) warnings.push({ kind: "points_capped", requested: pq.available, used: pq.used });
  }

  // ---- shipping
  let province: string | null = null;
  if (typeof req.addressId === "string") {
    if (ctx.customerId === undefined) throw appError("UNAUTHORIZED", { fa: "برای انتخاب نشانی وارد شوید" });
    const addr = await addresses.get(db, ctx.customerId, req.addressId);
    if (addr === null) throw appError("NOT_FOUND", { fa: "نشانی پیدا نشد" });
    province = addr.province;
  } else if (req.addressId !== undefined) {
    province = provinceCode(req.addressId.province);
  }
  const methods = await listActiveShippingMethods(db);
  const options = shippingOptions(methods, province ?? "THR", subtotal - couponAmount);
  const chosen = (req.shippingKey !== undefined ? options.find((o) => o.key === req.shippingKey) : undefined) ?? cheapestOption(options);
  const shipping = chosen?.cost ?? 0;

  // ---- totals (computeTotals rejects an empty line set - an all-removed cart is a 0 quote)
  const totals =
    priced.length > 0
      ? computeTotals({ lines: priced, ...(couponEval !== undefined ? { coupon: couponEval } : {}), pointsValue, shipping })
      : { subtotal: 0, couponAmount: 0, discount: 0, pointsDiscount: 0, shipping: 0, grandTotal: 0, freeShipping: false, lines: [] };

  const draft: Quote = {
    channel: ctx.channel,
    lines,
    subtotal: totals.subtotal,
    discount: totals.discount,
    pointsDiscount: totals.pointsDiscount,
    shipping: totals.shipping,
    grandTotal: totals.grandTotal,
    ...(couponEval !== undefined ? { coupon: { code: couponEval.code, kind: couponEval.kind, amount: totals.couponAmount } } : couponField !== undefined ? { coupon: couponField } : {}),
    ...(pointsField !== undefined ? { points: pointsField } : {}),
    shippingKey: chosen?.key ?? null,
    shippingOptions: options,
    warnings,
    sig: "",
    expiresAt: quoteExpiresAt(),
  };
  return { ...draft, sig: signQuote(draft, ctx.env.QUOTE_SIGNING_KEY) };
}
