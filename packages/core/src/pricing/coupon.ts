import {
  type Db,
  and,
  collectionProducts,
  coupons,
  couponRedemptions,
  eq,
  inArray,
  isNotNull,
  notInArray,
  orders,
  productCategories,
  products,
  sql,
} from "@namilux/db";
import type { ErrorCode } from "../errors";
import { faNorm, formatToman } from "../persian";
// DECISION (M0 step 3): CouponKind is declared once in ../constants and CouponEval / CouponScope /
// PricedLine once in ../types. This module re-exports the canonical declarations.
import type { CouponKind } from "../constants";
import type { CouponEval, CouponScope, PricedLine } from "../types";

export type { CouponKind, CouponEval, CouponScope };

export type CouponRow = {
  id: number;
  code: string;
  kind: CouponKind;
  value: number;
  minSubtotal: number;
  maxDiscount: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  usagePerCustomer: number;
  firstOrderOnly: boolean;
  customerId: string | null;
  applies: CouponScope;
  excludes: CouponScope;
  stackableWithPoints: boolean;
  isActive: boolean;
};

export type CouponFailReason =
  | "unknown"
  | "inactive"
  | "not_started"
  | "expired"
  | "min_subtotal"
  | "scope"
  | "usage_limit"
  | "per_customer"
  | "first_order_only"
  | "personal";

export type CouponFail = { error: ErrorCode; reason: CouponFailReason; fa: string };

export const COUPON_FA: Record<Exclude<CouponFailReason, "min_subtotal">, string> = {
  unknown: "این کد معتبر نیست",
  inactive: "این کد معتبر نیست",
  personal: "این کد معتبر نیست",
  not_started: "این کد هنوز فعال نشده",
  expired: "این کد منقضی شده",
  scope: "این کد شامل کالاهای سبد نمی‌شود",
  usage_limit: "ظرفیت استفاده از این کد تمام شده",
  per_customer: "شما قبلاً از این کد استفاده کرده‌اید",
  first_order_only: "این کد فقط برای اولین خرید معتبر است",
};

export function couponFailFa(reason: CouponFailReason, minSubtotal?: number): string {
  if (reason === "min_subtotal") {
    return `حداقل سبد برای این کد ${formatToman(minSubtotal ?? 0)} تومان است`;
  }
  return COUPON_FA[reason];
}

export function normalizeCouponCode(raw: string): string {
  const folded = faNorm(raw)
    .replace(/[\s\-_]/g, "")
    .toUpperCase();
  return /^[A-Z0-9]{3,32}$/.test(folded) ? folded : "";
}

/** A scope is empty when it names no ids at all. */
function scopeIsEmpty(scope: CouponScope): boolean {
  return (
    (scope.brandIds?.length ?? 0) === 0 &&
    (scope.categoryIds?.length ?? 0) === 0 &&
    (scope.collectionIds?.length ?? 0) === 0 &&
    (scope.productIds?.length ?? 0) === 0
  );
}

/**
 * A cart line with the metadata a coupon scope is matched against. `PricedLine` carries only
 * price and qty, so the DB wrapper hydrates brand/category/collection membership before resolving
 * which products a coupon applies to.
 */
export type CouponLineMeta = {
  productId: number;
  unitPrice: number;
  qty: number;
  brandId: number | null;
  categoryIds: number[];
  collectionIds: number[];
};

function matchesScope(line: CouponLineMeta, scope: CouponScope): boolean {
  if (scope.productIds?.includes(line.productId)) return true;
  if (line.brandId !== null && scope.brandIds?.includes(line.brandId)) return true;
  if (scope.categoryIds?.some((c) => line.categoryIds.includes(c))) return true;
  if (scope.collectionIds?.some((c) => line.collectionIds.includes(c))) return true;
  return false;
}

/**
 * Resolve which of the cart's products a coupon applies to and their subtotal. When both scopes are
 * empty the coupon covers "all" (computeTotals reads that as the whole subtotal); otherwise the eligible
 * product ids are enumerated so the arithmetic in money/totals.ts can price them.
 */
export function resolveEligible(
  lines: CouponLineMeta[],
  applies: CouponScope,
  excludes: CouponScope,
): { productIds: number[] | "all"; subtotal: number } {
  const appliesEmpty = scopeIsEmpty(applies);
  const excludesEmpty = scopeIsEmpty(excludes);
  const eligible = lines.filter(
    (l) => (appliesEmpty || matchesScope(l, applies)) && !(!excludesEmpty && matchesScope(l, excludes)),
  );
  const subtotal = eligible.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const productIds: number[] | "all" = appliesEmpty && excludesEmpty ? "all" : eligible.map((l) => l.productId);
  return { productIds, subtotal };
}

function fail(reason: CouponFailReason, minSubtotal?: number): CouponFail {
  return { error: "COUPON_INVALID", reason, fa: couponFailFa(reason, minSubtotal) };
}

export type CouponEvalCtx = {
  eligibleProductIds: number[] | "all";
  eligibleSubtotal: number;
  customerId?: string;
  now: Date;
  totalRedemptions: number;
  customerRedemptions: number;
  customerPaidOrders: number;
};

export function evaluateCouponRules(coupon: CouponRow, ctx: CouponEvalCtx): CouponEval | CouponFail {
  // Order of checks is DECIDED - the first failing gate wins.
  if (!coupon.isActive) return fail("inactive");
  if (coupon.startsAt !== null && coupon.startsAt.getTime() > ctx.now.getTime()) return fail("not_started");
  if (coupon.endsAt !== null && coupon.endsAt.getTime() <= ctx.now.getTime()) return fail("expired");
  if (coupon.customerId !== null && coupon.customerId !== ctx.customerId) return fail("personal");

  const noEligible = Array.isArray(ctx.eligibleProductIds) && ctx.eligibleProductIds.length === 0;
  if (noEligible) return fail("scope");
  if (ctx.eligibleSubtotal < coupon.minSubtotal) return fail("min_subtotal", coupon.minSubtotal);

  if (coupon.usageLimit !== null && ctx.totalRedemptions >= coupon.usageLimit) return fail("usage_limit");
  if (ctx.customerRedemptions >= coupon.usagePerCustomer) return fail("per_customer");
  if (coupon.firstOrderOnly && ctx.customerPaidOrders > 0) return fail("first_order_only");

  // The amount is NOT computed here - money/totals.ts (computeTotals) is the one arithmetic and reads
  // value / maxDiscount / minSubtotal / eligibleProductIds from this CouponEval.
  return {
    couponId: coupon.id,
    code: coupon.code,
    kind: coupon.kind,
    value: coupon.value,
    maxDiscount: coupon.maxDiscount,
    minSubtotal: coupon.minSubtotal,
    eligibleProductIds: ctx.eligibleProductIds,
    stackableWithPoints: coupon.stackableWithPoints,
  };
}

const DEAD_ORDER_STATUSES = ["failed", "expired", "cancelled"] as const;

/** Hydrate the cart's products with brand / category / collection membership (only when a scope needs it). */
async function loadLineMeta(db: Db, lines: PricedLine[]): Promise<CouponLineMeta[]> {
  const ids = lines.map((l) => l.productId);
  if (ids.length === 0) return [];
  const [prods, cats, cols] = await Promise.all([
    db.select({ id: products.id, brandId: products.brandId }).from(products).where(inArray(products.id, ids)),
    db
      .select({ productId: productCategories.productId, categoryId: productCategories.categoryId })
      .from(productCategories)
      .where(inArray(productCategories.productId, ids)),
    db
      .select({ productId: collectionProducts.productId, collectionId: collectionProducts.collectionId })
      .from(collectionProducts)
      .where(inArray(collectionProducts.productId, ids)),
  ]);
  const brandOf = new Map(prods.map((p) => [p.id, p.brandId]));
  const catOf = new Map<number, number[]>();
  for (const c of cats) catOf.set(c.productId, [...(catOf.get(c.productId) ?? []), c.categoryId]);
  const colOf = new Map<number, number[]>();
  for (const c of cols) colOf.set(c.productId, [...(colOf.get(c.productId) ?? []), c.collectionId]);
  return lines.map((l) => ({
    productId: l.productId,
    unitPrice: l.unitPrice,
    qty: l.qty,
    brandId: brandOf.get(l.productId) ?? null,
    categoryIds: catOf.get(l.productId) ?? [],
    collectionIds: colOf.get(l.productId) ?? [],
  }));
}

function toCouponRow(r: typeof coupons.$inferSelect): CouponRow {
  return {
    id: r.id,
    code: r.code,
    kind: r.kind,
    value: r.value,
    minSubtotal: r.minSubtotal,
    maxDiscount: r.maxDiscount,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    usageLimit: r.usageLimit,
    usagePerCustomer: r.usagePerCustomer,
    firstOrderOnly: r.firstOrderOnly,
    customerId: r.customerId,
    applies: r.appliesJson,
    excludes: r.excludesJson,
    stackableWithPoints: r.stackableWithPoints,
    isActive: r.isActive,
  };
}

export async function evaluateCoupon(
  db: Db,
  code: string,
  ctx: { lines: PricedLine[]; phone: string; customerId?: string },
  opts?: { lock?: boolean },
): Promise<CouponEval | CouponFail> {
  const normalized = normalizeCouponCode(code);
  if (normalized === "") return fail("unknown");

  const base = db.select().from(coupons).where(eq(coupons.code, normalized)).limit(1);
  const rows = opts?.lock ? await base.for("update") : await base;
  const row = rows[0];
  if (row === undefined) return fail("unknown");
  const coupon = toCouponRow(row);

  // Resolve which cart products this coupon covers (only hydrate metadata when a scope is set).
  const scoped = !scopeIsEmpty(coupon.applies) || !scopeIsEmpty(coupon.excludes);
  const meta = scoped
    ? await loadLineMeta(db, ctx.lines)
    : ctx.lines.map((l) => ({ productId: l.productId, unitPrice: l.unitPrice, qty: l.qty, brandId: null, categoryIds: [], collectionIds: [] }));
  const eligible = resolveEligible(meta, coupon.applies, coupon.excludes);

  // Redemption counts exclude dead orders so an abandoned checkout does not burn a single-use code.
  const [tot] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(couponRedemptions)
    .innerJoin(orders, eq(couponRedemptions.orderId, orders.id))
    .where(and(eq(couponRedemptions.couponId, row.id), notInArray(orders.status, [...DEAD_ORDER_STATUSES])));
  const [cust] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(couponRedemptions)
    .innerJoin(orders, eq(couponRedemptions.orderId, orders.id))
    .where(
      and(
        eq(couponRedemptions.couponId, row.id),
        eq(orders.phone, ctx.phone),
        notInArray(orders.status, [...DEAD_ORDER_STATUSES]),
      ),
    );
  const [paid] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.phone, ctx.phone), isNotNull(orders.paidAt)));

  return evaluateCouponRules(coupon, {
    eligibleProductIds: eligible.productIds,
    eligibleSubtotal: eligible.subtotal,
    ...(ctx.customerId !== undefined ? { customerId: ctx.customerId } : {}),
    now: new Date(),
    totalRedemptions: tot?.n ?? 0,
    customerRedemptions: cust?.n ?? 0,
    customerPaidOrders: paid?.n ?? 0,
  });
}

export async function recordRedemption(
  db: Db,
  i: { couponId: number; orderId: string; customerId: string; amount: number },
): Promise<void> {
  await db.insert(couponRedemptions).values({
    couponId: i.couponId,
    orderId: i.orderId,
    customerId: i.customerId,
    amount: i.amount,
  });
}
