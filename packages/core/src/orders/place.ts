import { type Db, customers, eq } from "@namilux/db";
import type { SalesChannel } from "../channel";
import type { PaymentDriverKey } from "../constants";
import { addresses } from "../customers/addresses";
import { appError } from "../errors";
import { reserve } from "../inventory/reservations";
import { loyalty } from "../loyalty/ledger";
import { evaluateCoupon, recordRedemption } from "../pricing/coupon";
import { MIN_GRAND_TOTAL, quote } from "../pricing/quote";
import { effectiveFlags } from "../settings/service";
import { MAX_PENDING_ORDERS_PER_CUSTOMER } from "../constants";
import { loadInstalmentEligibility, loadProductsForQuote } from "../inventory/repo";
import { assertInstalmentEligible } from "../pricing/instalment-eligibility";
import type { Settings } from "../settings/schema";
import type { OrderAddressSnapshot, OrderItem, OrderShippingSnapshot, PlaceResult, PricedLine } from "../types";
import type { PlaceRequest } from "../validation/checkout";
import type { Env } from "@namilux/config";
import { orderEvents } from "./events";
import type { PaymentDriver } from "./payments";
import { countPending, insertOrder, lockForUpdate, payments as paymentsRepo } from "./repo";
import { startPayment } from "./payments";
import { orderState } from "./state";

/**
 * The two emergency overrides travel with the rest of the environment: `effectiveFlags` reads them
 * beside `commerce.checkout_enabled` / `commerce.maintenance`, so a box can close checkout from
 * `/opt/namilux/.env` without a database write (and without a rebuild - the processes read the file
 * at start-up). Absent, the stored setting decides, exactly as before.
 */
export type PlaceEnv = {
  SITE_ORIGIN: string;
  QUOTE_SIGNING_KEY: string;
  PAYMENT_DRIVER: PaymentDriverKey;
  SNAPPPAY_ENABLED?: boolean;
  CHECKOUT_ENABLED?: boolean | undefined;
  MAINTENANCE?: boolean | undefined;
};
export type PlaceCtx = {
  customerId: string;
  phone: string;
  ip: string;
  ua: string;
  settings: Settings;
  env: PlaceEnv;
  /** Which storefront is placing - server-side, from the site instance; never client input. */
  channel: SalesChannel;
  drivers: { payment(key: PaymentDriverKey): PaymentDriver };
};

// DECISION (the spec intent + the placeRequestSchema shape): PlaceRequest carries only the quote
// inputs and the sig - not the signed totals or expiresAt - so the HMAC cannot be re-verified against a
// reconstructed quote (a fresh expiresAt differs every time). The server-authoritative re-quote IS the
// price-tamper defense: client prices never reach the server (the strict cartLinesSchema keeps only
// {productId, qty}), totals are recomputed from the DB, and a quote that can no longer be honoured at
// the same terms (a line removed/reduced, coupon exhausted) is rejected with PRICE_CHANGED / COUPON_INVALID.
// The current client also sends the total it confirmed. Older clients remain compatible, while
// a fresh checkout must re-confirm any change between its last quote and the order transaction.

function inlineSnapshot(a: NonNullable<PlaceRequest["address"]>): OrderAddressSnapshot {
  return {
    label: a.label ?? "",
    recipientName: a.recipientName,
    recipientPhone: a.recipientPhone,
    province: a.province,
    city: a.city,
    address: a.address,
    plaque: a.plaque ?? null,
    unit: a.unit ?? null,
    postcode: a.postcode,
  };
}

export async function placeOrder(db: Db, req: PlaceRequest, ctx: PlaceCtx): Promise<PlaceResult> {
  const flags = effectiveFlags(ctx.settings, ctx.env);
  if (!flags.checkoutEnabled) throw appError("CHECKOUT_DISABLED", { fa: "ثبت سفارش موقتاً غیرفعال است" });
  if (flags.maintenance) throw appError("MAINTENANCE", { fa: "سایت در حال به‌روزرسانی است؛ کمی بعد دوباره تلاش کنید" });

  if (ctx.channel !== "main" || (req.paymentMethod === "snapppay" && ctx.env.SNAPPPAY_ENABLED !== true && ctx.env.PAYMENT_DRIVER !== "mock")) {
    throw appError("VALIDATION", { fa: "این روش پرداخت در دسترس نیست", details: { field: "paymentMethod" } });
  }

  const order = await db.transaction(async (tx) => {
    // Inventory locks precede the customer lock, matching payment/reservation effects. Read the
    // quote only after these locks: an admin price edit must not slip between pricing and reserve.
    const products = await loadProductsForQuote(tx, req.lines.map((l) => l.productId), { lock: "update" });
    const [customer] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, ctx.customerId)).for("update");
    if (customer === undefined) throw appError("NOT_FOUND", { fa: "حساب کاربری پیدا نشد" });
    if ((await countPending(tx, ctx.customerId)) >= MAX_PENDING_ORDERS_PER_CUSTOMER) {
      throw appError("RATE_LIMITED", { fa: "سفارش‌های پرداخت‌نشدهٔ شما زیاد است؛ ابتدا یکی را کامل کنید" });
    }

    // Re-quote and debit points in the same transaction under the customer lock.
    const addressRef = req.addressId ?? (req.address !== undefined ? { province: req.address.province, city: req.address.city } : undefined);
    const q = await quote(
      tx,
      { lines: req.lines, ...(req.couponCode !== undefined ? { couponCode: req.couponCode } : {}), usePoints: req.usePoints === true, shippingKey: req.shippingKey, ...(addressRef !== undefined ? { addressId: addressRef } : {}) },
      { customerId: ctx.customerId, phone: ctx.phone, settings: ctx.settings, env: ctx.env as unknown as Env, channel: ctx.channel, lockCoupon: true },
    );

    // Checked BEFORE the generic "your basket changed" answer so the shopper is told which products
    // block instalments: the instalment quote drops a switched-off product as a removed line, and a
    // PRICE_CHANGED would hide why. Whether this is an instalment purchase is decided by the site
    // and - under the simulator, where any method is accepted - by the method posted, so a
    // `snapppay` request on the main site cannot slip an ineligible product past it either.
    const instalmentPurchase = ctx.channel === "instalments" || req.paymentMethod === "snapppay";
    if (instalmentPurchase) {
      assertInstalmentEligible(await loadInstalmentEligibility(tx, q.lines.map((l) => l.productId)));
    }

    if (q.lines.some((l) => l.status === "removed" || l.status === "qty_reduced")) {
      throw appError("PRICE_CHANGED", { fa: "سبد شما به‌روز شد؛ لطفاً دوباره بررسی کنید", details: { quote: q } });
    }
    if (req.couponCode !== undefined && q.coupon !== undefined && "error" in q.coupon) {
      throw appError("COUPON_INVALID", { fa: "کد تخفیف دیگر معتبر نیست", details: { quote: q } });
    }
    if (q.grandTotal < MIN_GRAND_TOTAL) throw appError("VALIDATION", { fa: "مبلغ سفارش کمتر از حد مجاز است" });
    if (req.expectedGrandTotal !== undefined && req.expectedGrandTotal !== q.grandTotal) {
      throw appError("PRICE_CHANGED", { fa: "مبلغ سفارش تغییر کرده؛ لطفاً دوباره بررسی کنید", details: { quote: q } });
    }
    if (q.shippingKey !== req.shippingKey) {
      throw appError("PRICE_CHANGED", { fa: "روش ارسال تغییر کرده؛ لطفاً دوباره انتخاب کنید", details: { quote: q } });
    }

    const okLines = q.lines.filter((l) => l.status === "ok");
    if (okLines.length === 0) throw appError("VALIDATION", { fa: "سبد خرید خالی است" });

    const byId = new Map(products.map((p) => [p.id, p]));
    // The authoritative check: the switch as it stands on the rows now locked FOR UPDATE, so an
    // admin turning it off between the quote above and this line still wins.
    if (instalmentPurchase) assertInstalmentEligible(products);

    const items: Omit<OrderItem, "id" | "orderId">[] = okLines.map((l) => {
      const p = byId.get(l.productId);
      return {
        productId: l.productId,
        name: l.name,
        sku: p?.sku ?? null,
        modelCode: p?.modelCode ?? null,
        colorName: p?.colorName ?? null,
        imageKey: p?.imageKey ?? l.image,
        unitPrice: l.unitPrice,
        compareAtPrice: p?.compareAt ?? null,
        qty: l.qty,
        lineTotal: l.lineTotal,
        warrantyMonths: p?.warrantyMonths ?? null,
      };
    });

    // Address + shipping snapshots.
    let address: OrderAddressSnapshot;
    if (req.addressId !== undefined) {
      const a = await addresses.get(tx, ctx.customerId, req.addressId);
      if (a === null) throw appError("NOT_FOUND", { fa: "نشانی پیدا نشد" });
      address = addresses.snapshot(a);
    } else if (req.address !== undefined) {
      address = inlineSnapshot(req.address);
    } else {
      throw appError("VALIDATION", { fa: "نشانی ارسال را وارد کنید" });
    }
    const chosen = q.shippingOptions.find((o) => o.key === q.shippingKey);
    const shipping: OrderShippingSnapshot = chosen ?? { key: q.shippingKey ?? req.shippingKey, name: "", etaMin: 0, etaMax: 0, cost: q.shipping };

    const ttl = ctx.settings["commerce.pending_ttl_min"];
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();

    // Coupon lock + redemption (re-evaluate under FOR UPDATE for the couponId).
    let couponId: number | null = null;
    let couponCode: string | null = null;
    let couponAmount = 0;
    if (q.coupon !== undefined && "code" in q.coupon) {
      const priced: PricedLine[] = okLines.map((l) => ({ productId: l.productId, unitPrice: l.unitPrice, qty: l.qty, compareAt: byId.get(l.productId)?.compareAt ?? null }));
      const ce = await evaluateCoupon(tx, q.coupon.code, { lines: priced, phone: ctx.phone, customerId: ctx.customerId }, { lock: true });
      if ("error" in ce) throw appError("COUPON_INVALID", { fa: "کد تخفیف دیگر معتبر نیست", details: { quote: q } });
      couponId = ce.couponId;
      couponCode = ce.code;
      couponAmount = q.discount;
    }

    const created = await insertOrder(tx, {
      invoiceNo: null,
      customerId: ctx.customerId,
      phone: ctx.phone,
      email: null,
      status: "pending_payment",
      source: "web",
      channel: ctx.channel,
      channelRef: null,
      subtotal: q.subtotal,
      discountTotal: q.discount,
      shippingTotal: q.shipping,
      pointsDiscount: q.pointsDiscount,
      grandTotal: q.grandTotal,
      couponId,
      couponCode,
      pointsRedeemed: q.points?.used ?? 0,
      pointsEarned: 0,
      shippingMethodKey: q.shippingKey ?? req.shippingKey,
      shipping,
      address,
      customerNote: req.note ?? null,
      adminNote: null,
      giftMessage: req.gift?.message ?? null,
      isGift: req.gift !== undefined,
      placedAt: nowIso,
      paidAt: null,
      shippedAt: null,
      deliveredAt: null,
      cancelledAt: null,
      cancelReason: null,
      expiresAt,
      items,
    });

    await reserve(tx, created.id, okLines.map((l) => ({ productId: l.productId, qty: l.qty })), ttl);
    await loyalty.redeemForOrder(tx, ctx.customerId, created.id, created.pointsRedeemed);
    if (couponId !== null) await recordRedemption(tx, { couponId, orderId: created.id, customerId: ctx.customerId, amount: couponAmount });
    await orderEvents.append(tx, created.id, "placed", { source: "web", channel: ctx.channel }, { type: "customer", id: ctx.customerId });
    return created;
  });

  // Payment starts after the order tx commits. The channel's gateway takes the money - except when
  // the environment is running the simulator (dev/staging), where every method funnels through the
  // mock so the e2e flow keeps working without live credentials.
  const driverKey: PaymentDriverKey = ctx.env.PAYMENT_DRIVER === "mock" ? "mock" : req.paymentMethod;
  try {
    // Resolving the driver is inside the try on purpose: a method the deployment has no credentials
    // for (a box with no SnappPay keys) throws here, and the order must still be failed and its
    // stock released rather than left pending behind a 500.
    const driver = ctx.drivers.payment(driverKey);
    const { redirectUrl } = await startPayment(db, order, driver, ctx.env);
    return { order, payment: { redirectUrl } };
  } catch (err: unknown) {
    // A retry can win between the order commit and this request. Only fail an order without a
    // live payment attempt, under the same lock used by starts/callbacks; never release its stock
    // or points because this particular request lost that race.
    await db.transaction(async (tx) => {
      const current = await lockForUpdate(tx, order.id);
      if (current?.status !== "pending_payment") return;
      const attempts = await paymentsRepo.listForOrder(tx, order.id);
      if (attempts.some((p) => p.status === "initiated" || p.status === "redirected" || p.status === "succeeded")) return;
      await orderState.transition(tx, order.id, "failed", { actor: { type: "system", id: null }, settings: ctx.settings });
    }).catch(() => undefined);
    if (err instanceof Error && "code" in err) throw err;
    throw appError("PAYMENT_FAILED", { httpStatus: 502, fa: "اتصال به درگاه برقرار نشد؛ دوباره تلاش کنید" });
  }
}
