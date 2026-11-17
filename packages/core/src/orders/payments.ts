import { sql, type Db } from "@namilux/db";
import type { PaymentDriverKey } from "../constants";
import { enDigits } from "../persian";
import { appError } from "../errors";
import { loyalty } from "../loyalty/ledger";
import { DEFAULT_PENDING_TTL_MIN, reserve } from "../inventory/reservations";
import { loadInstalmentEligibility } from "../inventory/repo";
import { assertInstalmentEligible } from "../pricing/instalment-eligibility";
import type { Settings } from "../settings/schema";
import type { Order, Payment } from "../types";
import { orderEvents } from "./events";
import { findById, lockForUpdate, payments as paymentsRepo, updateStatus } from "./repo";

/** One basket line as a gateway sees it. Prices are Toman; a driver converts if its API wants Rial. */
export type PaymentCartItem = { id: number; name: string; unitPrice: number; qty: number };
/** The order broken out the way instalment gateways demand (SnappPay's cartList). All Toman. */
export type PaymentCart = { items: PaymentCartItem[]; itemsTotal: number; discount: number; shipping: number; tax: number };

export type PaymentRequestInput = { amount: number; description: string; callbackUrl: string; mobile?: string; orderCode: string; cart?: PaymentCart };
/**
 * `providerRef` is a second handle some gateways mint at redirect time and require for every later
 * call (SnappPay's paymentToken drives verify/settle/revert/cancel). It is stored in payments.ref_id
 * so the callback, the settle job and a later refund can all find it.
 */
export type PaymentRequestResult = { ok: true; authority: string; redirectUrl: string; providerRef?: string } | { ok: false; error: string; customerMessage?: string };

export type PaymentVerifyResult =
  | { ok: true; refId: string; cardPan?: string; fee?: number; alreadyVerified: boolean; needsSettle?: boolean }
  | { ok: false; code?: number; error?: string };

export interface PaymentDriver {
  key: PaymentDriverKey;
  /**
   * Gateways that only serve some baskets answer here (SnappPay instalments have a credit floor and
   * per-shopper limits). A driver without it is always offered.
   */
  eligible?(o: { amount: number }): Promise<{ ok: boolean; message?: string; description?: string }>;
  /**
   * Normalise the gateway's own callback field names into {authority, ok}. Absent ⇒ ZarinPal's
   * `Authority` + `Status=OK`, which handleCallback reads directly.
   */
  parseCallback?(params: Record<string, string>): { authority: string; ok: boolean };
  request(o: PaymentRequestInput): Promise<PaymentRequestResult>;
  verify(o: { amount: number; authority: string; providerRef?: string }): Promise<PaymentVerifyResult>;
  /**
   * Two-phase gateways only: commit a verified withdrawal. SnappPay holds the money after verify and
   * drops it unless settle runs (their doc: "by the end of the day"); ZarinPal has no such step.
   */
  settle?(o: { authority: string; providerRef?: string }): Promise<{ ok: boolean; error?: string }>;
  /** Give back a verified-but-unsettled payment · SnappPay revert, ZarinPal reverse (≤30 min). */
  reverse?(o: { authority: string; providerRef?: string }): Promise<{ ok: boolean; error?: string }>;
  /** Read-only status probe. Never treat it as a verify · ZarinPal says so explicitly. */
  inquiry?(o: { authority: string; providerRef?: string }): Promise<{ ok: boolean; status?: string; code?: number }>;
  /** Money taken but never verified · the reconciliation list a nightly sweep reads. */
  unverified?(): Promise<{ ok: boolean; authorities: { authority: string; amount: number; date: string }[] }>;
  /** What the gateway will take on an amount, before a transaction exists. Toman in, Toman out. */
  feeCalculation?(amount: number): Promise<{ ok: boolean; fee?: number; feeType?: string; suggestedAmount?: number }>;
  /**
   * Set by a gateway whose only refund path clears the whole order. `refund` is
   * refused before it is called for anything smaller · see orders/refunds.ts.
   */
  refundsInFullOnly?: boolean;
  /**
   * `full` says whether this refund clears the whole order, so a gateway that can only refund in
   * full rejects a partial one instead of over-refunding.
   */
  refund?(o: { refId: string; amount: number; reason: string; full: boolean; cart?: PaymentCart; remainingAmount?: number }): Promise<{ ok: boolean; ref?: string; error?: string }>;
}

/** Break an order out into the line/shipping/discount shape an instalment gateway needs. */
export function cartFor(order: Order): PaymentCart {
  return {
    items: order.items.map((it) => ({ id: it.productId, name: it.name, unitPrice: it.unitPrice, qty: it.qty })),
    itemsTotal: order.subtotal,
    discount: order.discountTotal + order.pointsDiscount,
    shipping: order.shippingTotal,
    tax: 0, // prices are VAT-inclusive (commerce.vat_percent is a display split, never a separate line)
  };
}

/**
 * Which ref_id to store after a verify.
 *
 * ZarinPal answers a REPLAYED verify with code 101 and, in that case, may omit `ref_id` altogether - 
 * the driver then reports it as "". Writing that over the reference captured on the first, complete
 * verify would lose the only handle a later refund has, so an empty answer keeps what is stored.
 */
export function refIdAfterVerify(verified: string, stored: string | null): string | null {
  return verified === "" ? stored : verified;
}

export function describeForGateway(order: Order): string {
  return `سفارش ${order.code} · نامی‌لوکس`.slice(0, 100);
}

export function paymentLinkFor(order: Order, env: { SITE_ORIGIN: string }): string {
  return `${env.SITE_ORIGIN}/pay/${order.code}/`;
}

export function maskPan(pan: string | undefined): string | null {
  if (pan === undefined) return null;
  const digits = enDigits(pan).replace(/\D/g, "");
  if (digits.length !== 16) return null;
  const masked = `${digits.slice(0, 6)}******${digits.slice(-4)}`;
  return `${masked.slice(0, 4)}-${masked.slice(4, 8)}-${masked.slice(8, 12)}-${masked.slice(12, 16)}`;
}

function callbackUrl(env: { SITE_ORIGIN: string }, driverKey: string): string {
  return `${env.SITE_ORIGIN}/api/payment/callback/${driverKey}`;
}

type StartedPayment = { payment: Payment; redirectUrl: string };

async function requestPaymentAttempt(db: Db, order: Order, driver: PaymentDriver, env: { SITE_ORIGIN: string }): Promise<({ ok: true } & StartedPayment) | Extract<PaymentRequestResult, { ok: false }>> {
  const payment = await paymentsRepo.insert(db, {
    orderId: order.id,
    driver: driver.key,
    amount: order.grandTotal, // always the stored grand_total, never a client figure
    status: "initiated",
    authority: null,
    refId: null,
    cardPanMasked: null,
    fee: null,
  });
  await orderEvents.append(db, order.id, "payment.initiated", { driver: driver.key }, { type: "system", id: null });

  const result: PaymentRequestResult = await driver.request({
    amount: order.grandTotal,
    description: describeForGateway(order),
    callbackUrl: callbackUrl(env, driver.key),
    mobile: order.phone,
    orderCode: order.code,
    cart: cartFor(order),
  }).catch(() => ({ ok: false as const, error: "gateway request failed" }));

  if (!result.ok) {
    await paymentsRepo.update(db, payment.id, { status: "failed" });
    await orderEvents.append(db, order.id, "payment.failed", { reason: result.error }, { type: "system", id: null });
    return result;
  }

  // The provider ref (SnappPay's paymentToken) is written NOW, not at verify: the callback, the
  // settle job and a later refund all need it, and only this response ever carries it.
  await paymentsRepo.update(db, payment.id, {
    status: "redirected",
    authority: result.authority,
    ...(result.providerRef !== undefined ? { refId: result.providerRef } : {}),
  });
  await orderEvents.append(db, order.id, "payment.redirected", { authority: result.authority }, { type: "system", id: null });
  const updated = await paymentsRepo.findByAuthority(db, result.authority);
  return { ok: true, payment: updated ?? { ...payment, status: "redirected", authority: result.authority }, redirectUrl: result.redirectUrl };
}

export async function startPayment(db: Db, order: Order, driver: PaymentDriver, env: { SITE_ORIGIN: string }): Promise<StartedPayment> {
  const result = driver.key === "snapppay"
    ? await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '300s'`);
      const current = await lockForUpdate(tx, order.id);
      if (current === null) throw appError("NOT_FOUND", { fa: "سفارش پیدا نشد" });
      const attempts = await paymentsRepo.listForOrder(tx, order.id);
      if (current.status !== "pending_payment" || attempts.some((p) => p.status === "succeeded" || (p.driver === "snapppay" && (p.status === "initiated" || p.status === "redirected")))) {
        throw appError("CONFLICT", { fa: "وضعیت پرداخت قبلی باید پیش از تلاش دوباره مشخص شود" });
      }
      if (driver.eligible !== undefined && !(await driver.eligible({ amount: current.grandTotal })).ok) {
        throw appError("PAYMENT_FAILED", { fa: "پرداخت اقساطی برای این مبلغ در حال حاضر امکان‌پذیر نیست" });
      }
      // Keep the lock through token creation and reference persistence. Concurrent retry clicks
      // must see the redirected attempt before requesting another token. No shopper is redirected
      // until commit; a request failure is committed as failed before the outer error is thrown.
      return requestPaymentAttempt(tx, current, driver, env);
    })
    : await requestPaymentAttempt(db, order, driver, env);
  if (!result.ok) throw appError("PAYMENT_FAILED", { httpStatus: 502, fa: result.customerMessage ?? "اتصال به درگاه پرداخت ممکن نشد؛ کمی بعد دوباره تلاش کنید" });
  return { payment: result.payment, redirectUrl: result.redirectUrl };
}

export async function retryPayment(
  db: Db,
  orderId: string,
  ctx: { customerId: string; drivers: { payment(key: PaymentDriverKey): PaymentDriver }; env: { SITE_ORIGIN: string }; settings: Settings },
): Promise<{ redirectUrl: string }> {
  const order = await db.transaction(async (tx) => {
    const o = await lockForUpdate(tx, orderId);
    if (o === null) throw appError("NOT_FOUND", { fa: "سفارش پیدا نشد" });
    if (o.customerId !== ctx.customerId) throw appError("FORBIDDEN", { fa: "دسترسی مجاز نیست" });
    if (await paymentsRepo.succeededFor(tx, orderId)) throw appError("CONFLICT", { fa: "این سفارش قبلاً پرداخت شده است" });
    if (o.status !== "failed" && o.status !== "expired" && o.status !== "pending_payment") {
      throw appError("CONFLICT", { fa: "امکان پرداخت دوباره برای این سفارش نیست" });
    }
    // A retry opens a fresh gateway session, so an instalment order answers to the instalment switch
    // as it stands NOW: a product the admin turned off after the order was placed cannot be sent to
    // SnappPay again (the order stays as it is; it can be cancelled or re-bought by card).
    const started = await paymentsRepo.listForOrder(tx, orderId);
    if (started.some((p) => p.driver === "snapppay" && (p.status === "initiated" || p.status === "redirected"))) {
      throw appError("CONFLICT", { fa: "وضعیت پرداخت قبلی باید پیش از تلاش دوباره مشخص شود" });
    }
    if (started[0]?.driver === "snapppay") {
      assertInstalmentEligible(await loadInstalmentEligibility(tx, o.items.map((it) => it.productId)));
    }
    // Re-reserve stock (checkReservable throws OUT_OF_STOCK with the lines) and move back to pending.
    if (o.status === "failed" || o.status === "expired") {
      const ttl = ctx.settings["commerce.pending_ttl_min"] ?? DEFAULT_PENDING_TTL_MIN;
      await reserve(tx, orderId, o.items.map((it) => ({ productId: it.productId, qty: it.qty })), ttl);
      // Failure/expiry released the original debit. Reclaim the stored discount before opening
      // another gateway session; insufficient points rolls back the new reservation as well.
      await loyalty.redeemForOrder(tx, ctx.customerId, orderId, o.pointsRedeemed);
      const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();
      const ok = await updateStatus(tx, orderId, o.status, "pending_payment", { expiresAt });
      if (!ok) throw appError("CONFLICT", { fa: "تغییر وضعیت مجاز نیست" });
      await orderEvents.append(tx, orderId, "note", { note: "retry_payment" }, { type: "customer", id: ctx.customerId });
    }
    const refreshed = await findById(tx, orderId);
    if (refreshed === null) throw appError("NOT_FOUND", { fa: "سفارش پیدا نشد" });
    return refreshed;
  });
  // Retry on the gateway the order started on: an instalment order cannot fall back to a card
  // gateway (the shopper chose credit), and vice versa.
  const previous = await paymentsRepo.listForOrder(db, orderId);
  const driverKey = previous[0]?.driver;
  const driver = ctx.drivers.payment(driverKey ?? "zarinpal");
  const { redirectUrl } = await startPayment(db, order, driver, ctx.env);
  return { redirectUrl };
}
