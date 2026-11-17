import { randomBytes } from "node:crypto";
import { httpJson } from "../http";
import type { PaymentDriver, PaymentCart } from "./types";

/**
 * SnappPay - «خرید اقساطی» (BNPL / instalments), REST API v1.7.
 *
 * Shape of the integration, from SnappPay's own document:
 *   token   POST /api/online/v1/oauth/token       Basic client_id:client_secret, form body, JWT out
 *   eligible GET /api/online/offer/v1/eligible    may this basket be bought on credit at all?
 *   token   POST /api/online/payment/v1/token     paymentToken + paymentPageUrl (redirect target)
 * -  - shopper pays on SnappPay, who POSTs a form back to returnURL -  - 
 *   verify  POST /api/online/payment/v1/verify    confirms the withdrawal - money is HELD, not taken
 *   settle  POST /api/online/payment/v1/settle    takes it. Mandatory, "by the end of the day"
 *   revert  POST /api/online/payment/v1/revert    give a verified-but-unsettled hold back
 *   cancel  POST /api/online/payment/v1/cancel    full refund once settled
 *   update  POST /api/online/payment/v1/update    lower a settled amount (partial refund)
 *   status  GET  /api/online/payment/v1/status    read-only probe
 *
 * TWO THINGS THAT WILL BITE:
 *  1. Every amount on this API is RIAL. Our orders are Toman, so everything is ×10 on the way out.
 *  2. SnappPay authorises by SOURCE IP (their gateway answers "RBAC: access denied" otherwise) and
 *     only accepts a returnURL under the base URL registered at onboarding. Both are changed by
 *     SnappPay support, not from a panel.
 */

const RIAL_PER_TOMAN = 10;
const toRial = (toman: number): number => Math.round(toman) * RIAL_PER_TOMAN;

/** The error codes SnappPay documents. Everything else falls through to a generic message. */
export const SNAPPPAY_ERRORS: Record<number, string> = {
  1000: "خطای داخلی سرویس اسنپ‌پی",
  1003: "توکن نامعتبر است",
  1008: "این تراکنش تکراری است",
  1011: "وضعیت تراکنش برای این عملیات معتبر نیست",
  1013: "پذیرنده مسدود است",
};

export function snapppayError(code: number | undefined, fallback?: string): string {
  if (code !== undefined && SNAPPPAY_ERRORS[code] !== undefined) return SNAPPPAY_ERRORS[code] ?? "";
  return fallback !== undefined && fallback !== "" ? fallback : "خطای درگاه اقساطی";
}

/** Every 2xx body from SnappPay is {successful, response}; every error is {successful:false, errorData}. */
type SnappEnvelope<T> = { successful?: boolean; response?: T; errorData?: { errorCode?: number; message?: string; data?: unknown } };
type TokenGrant = { access_token?: string; token_type?: string; expires_in?: number; scope?: string };
type EligibleRes = { eligible?: boolean; title_message?: string; description?: string };
type PaymentTokenRes = { paymentToken?: string; paymentPageUrl?: string };
type TxnRes = { transactionId?: string; status?: string };

export type SnapppayConfig = {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  /** Sent verbatim as cartItems[].category. SnappPay maps it to a commission rate on their side. */
  category?: string;
};

const DEFAULT_CATEGORY = "لوازم خانگی";
/** SnappPay's verify rule: wait up to 30 s, then ask /status (academy «self-cms» §11). */
const VERIFY_TIMEOUT_MS = 30_000;
const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Our transaction number as SnappPay asks for it: unique per attempt and 5–10 characters, letters
 * allowed (§5). The order code's five characters come first, so a number in SnappPay's portal leads
 * straight to the order (NL-WR6KT → WR6KT…), and five random ones make each attempt unique.
 */
export function snapppayTransactionId(orderCode: string): string {
  const head = orderCode.replace(/^NL-/u, "").replace(/[^A-Z0-9]/giu, "").toUpperCase().slice(0, 5);
  const bytes = randomBytes(10);
  let tail = "";
  for (let i = 0; tail.length < 10 - head.length; i++) tail += ALNUM[(bytes[i] ?? 0) % ALNUM.length];
  return `${head}${tail}`;
}

/** SnappPay wants E.164; our orders store 09xxxxxxxxx. The field is REQUIRED (§6): no number, no payment. */
export function snapppayMobile(phone: string | undefined): string | undefined {
  if (phone === undefined) return undefined;
  const digits = phone.replace(/[^\d+]/gu, "");
  if (/^\+98\d{10}$/u.test(digits)) return digits;
  if (/^0098\d{10}$/u.test(digits)) return `+98${digits.slice(4)}`;
  if (/^98\d{10}$/u.test(digits)) return `+${digits}`;
  if (/^09\d{9}$/u.test(digits)) return `+98${digits.slice(1)}`;
  if (/^9\d{9}$/u.test(digits)) return `+98${digits}`;
  return undefined;
}

/**
 * cartList as SnappPay models it: `totalAmount` is the basket BEFORE discount, `cartItems[].amount`
 * is the per-unit price, and the top-level `amount` is what the shopper actually owes. The difference
 * between the two goes in `discountAmount`, and their sum has to reconcile or the token is rejected.
 *
 * The discount is DERIVED from `payable` rather than read off the cart: `payable` is the order's
 * stored grand total, the one figure the money must match, so deriving makes the reconciliation true
 * by construction instead of trusting two numbers to agree.
 */
export function snapppayCart(cart: PaymentCart, payable: number, category: string): Record<string, unknown> {
  const items = cart.items.map((it) => ({
    id: it.id,
    name: it.name.slice(0, 120),
    count: it.qty,
    amount: toRial(it.unitPrice),
    category,
    // §6: «در صورتی که تنوع دسته‌بندی محصولات شما زیاد نیست، پارامتر commissionType را به‌صورت
    // پیش‌فرض عدد ۱۰۰ ارسال کنید» - one shop of home appliances, so the documented default.
    commissionType: 100,
  }));
  const grossToman = cart.itemsTotal + cart.shipping + cart.tax;
  const discount = Math.max(0, grossToman - payable);
  return {
    amount: toRial(payable),
    discountAmount: toRial(discount),
    externalSourceAmount: 0,
    cartList: [
      {
        cartId: 1,
        totalAmount: toRial(payable),
        shippingAmount: toRial(cart.shipping),
        isShipmentIncluded: cart.shipping > 0,
        taxAmount: toRial(cart.tax),
        isTaxIncluded: cart.tax > 0,
        cartItems: items,
      },
    ],
  };
}

export function snapppayDriver(cfg: SnapppayConfig): PaymentDriver {
  const base = cfg.baseUrl.replace(/\/+$/u, "");
  const category = cfg.category ?? DEFAULT_CATEGORY;
  /**
   * A fresh JWT for every operation. SnappPay says it plainly (§3 and the FAQ): «توکن دسترسی (JWT)
   * را کش نکنید» - a cached token was the cause of their access errors. A failure here is returned,
   * never thrown: a dead gateway must surface as a not-ok payment, the same way ZarinPal's does.
   */
  async function bearer(): Promise<string | null> {
    const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
    try {
      const res = await httpJson<TokenGrant>(`${base}/api/online/v1/oauth/token`, {
        method: "POST",
        headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        timeoutMs: 10_000,
        retries: 0,
        body: new URLSearchParams({ grant_type: "password", scope: "online-merchant", username: cfg.username, password: cfg.password }).toString(),
      });
      if (!res.ok) return null;
      const token = res.data?.access_token;
      if (typeof token !== "string" || token === "") return null;
      return token;
    } catch {
      return null;
    }
  }

  async function call<T>(
    path: string,
    method: "GET" | "POST",
    body?: Record<string, unknown>,
    timeoutMs = 15_000,
  ): Promise<{ ok: boolean; data: T | null; code?: number; message?: string }> {
    const token = await bearer();
    if (token === null) return { ok: false, data: null, message: "authentication failed" };
    try {
      const res = await httpJson<SnappEnvelope<T>>(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
        timeoutMs,
        retries: 0,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const env = res.data;
      if (res.ok && env?.successful === true) return { ok: true, data: env.response ?? null };
      const code = env?.errorData?.errorCode;
      return {
        ok: false,
        data: null,
        ...(typeof code === "number" ? { code } : {}),
        ...(typeof env?.errorData?.message === "string" ? { message: env.errorData.message } : { message: `http ${String(res.status)}` }),
      };
    } catch {
      return { ok: false, data: null, message: "transport" };
    }
  }

  return {
    key: "snapppay",

    /**
     * Instalments are not offered on every basket - SnappPay decides per amount (and, once the
     * shopper is known to them, per credit line). A not-ok answer hides the option at checkout.
     */
    async eligible(o) {
      const res = await call<EligibleRes>(`/api/online/offer/v1/eligible?amount=${String(toRial(o.amount))}`, "GET");
      if (!res.ok) return { ok: false, ...(res.message !== undefined ? { message: snapppayError(res.code, res.message) } : {}) };
      const yes = res.data?.eligible === true;
      const title = res.data?.title_message;
      return { ok: yes, ...(typeof title === "string" && title !== "" ? { message: title } : {}), ...(typeof res.data?.description === "string" ? { description: res.data.description } : {}) };
    },

    /**
     * `transactionId` is OURS and must be unique per attempt - it is the only field SnappPay echoes
     * in the callback, so it becomes the payment's authority. The paymentToken they mint comes back
     * as providerRef and drives every later call.
     */
    async request(o) {
      const cart: PaymentCart = o.cart ?? { items: [{ id: 1, name: o.description, unitPrice: o.amount, qty: 1 }], itemsTotal: o.amount, discount: 0, shipping: 0, tax: 0 };
      // payments.authority carries a UNIQUE index, so a retry must never reuse this. Time alone is
      // not enough of a guarantee, hence the random tail.
      const transactionId = snapppayTransactionId(o.orderCode);
      const mobile = snapppayMobile(o.mobile);
      if (mobile === undefined) return { ok: false, error: "شمارهٔ موبایل خریدار برای پرداخت اقساطی لازم است" };
      const res = await call<PaymentTokenRes>("/api/online/payment/v1/token", "POST", {
        ...snapppayCart(cart, o.amount, category),
        paymentMethodTypeDto: "INSTALLMENT",
        returnURL: o.callbackUrl,
        transactionId,
        mobile,
      });
      const paymentToken = res.data?.paymentToken;
      const paymentPageUrl = res.data?.paymentPageUrl;
      if (res.ok && typeof paymentToken === "string" && paymentToken !== "" && typeof paymentPageUrl === "string") {
        try {
          const destination = new URL(paymentPageUrl);
          if (destination.protocol !== "https:" || destination.username !== "" || destination.password !== "") return { ok: false, error: "invalid payment redirect" };
        } catch { return { ok: false, error: "invalid payment redirect" }; }
        return { ok: true, authority: transactionId, redirectUrl: paymentPageUrl, providerRef: paymentToken };
      }
      return { ok: false, error: `snapppay token: ${snapppayError(res.code, res.message)}` };
    },

    /** SnappPay POSTs a form back: transactionId (ours), state=OK|FAILED, amount. */
    parseCallback(params) {
      const authority = params["transactionId"] ?? params["transactionid"] ?? "";
      const state = params["state"] ?? params["State"] ?? "";
      return { authority, ok: state === "OK" || state === "ok" };
    },

    /**
     * Confirms the withdrawal. Note what this does NOT do: the money is only HELD afterwards, and
     * SnappPay returns it to the shopper unless settle runs - hence needsSettle.
     * The amount is not re-checked here because SnappPay's verify takes only the token; the basket
     * was fixed when the token was minted, so it cannot have drifted.
     */
    async verify(o) {
      if (o.providerRef === undefined) return { ok: false, error: "missing paymentToken" };
      const statusPath = `/api/online/payment/v1/status?paymentToken=${encodeURIComponent(o.providerRef)}`;
      // §11: verify with a 30-second wait; without an answer ask /status. VERIFY → settle,
      // PENDING → verify again, anything else → not paid.
      let res = await call<TxnRes>("/api/online/payment/v1/verify", "POST", { paymentToken: o.providerRef }, VERIFY_TIMEOUT_MS);
      if (!res.ok) {
        let probe = await call<TxnRes>(statusPath, "GET");
        if (probe.ok && probe.data?.status === "PENDING") {
          res = await call<TxnRes>("/api/online/payment/v1/verify", "POST", { paymentToken: o.providerRef }, VERIFY_TIMEOUT_MS);
          if (res.ok) return { ok: true, refId: o.providerRef, alreadyVerified: false, needsSettle: true };
          probe = await call<TxnRes>(statusPath, "GET");
        }
        // An earlier verify/settle may have succeeded before a timeout or process crash.
        if (probe.ok && (probe.data?.status === "VERIFY" || probe.data?.status === "SETTLE")) {
          return { ok: true, refId: o.providerRef, alreadyVerified: true, needsSettle: probe.data.status === "VERIFY" };
        }
        return { ok: false, ...(res.code !== undefined ? { code: res.code } : {}), error: snapppayError(res.code, res.message) };
      }
      // refId stays the paymentToken: settle, cancel and update are all keyed on it, and it is the
      // only handle that still works after the order is paid.
      return { ok: true, refId: o.providerRef, alreadyVerified: false, needsSettle: true };
    },

    /** Takes the held money. Until this runs the shopper has not actually been charged. */
    async settle(o) {
      if (o.providerRef === undefined) return { ok: false, error: "missing paymentToken" };
      const statusPath = `/api/online/payment/v1/status?paymentToken=${encodeURIComponent(o.providerRef)}`;
      // §12: false or no answer → /status; SETTLE = done, VERIFY = settle again. Anything still open
      // after that is left to the durable payment.settle job, which keeps retrying.
      let res = await call<TxnRes>("/api/online/payment/v1/settle", "POST", { paymentToken: o.providerRef });
      if (res.ok) return { ok: true };
      let probe = await call<TxnRes>(statusPath, "GET");
      if (probe.ok && probe.data?.status === "VERIFY") {
        res = await call<TxnRes>("/api/online/payment/v1/settle", "POST", { paymentToken: o.providerRef });
        if (res.ok) return { ok: true };
        probe = await call<TxnRes>(statusPath, "GET");
      }
      return probe.ok && probe.data?.status === "SETTLE" ? { ok: true } : { ok: false, error: snapppayError(res.code, res.message) };
    },

    /** Hands a verified-but-unsettled hold back. Impossible once settle has run - use refund then. */
    async reverse(o) {
      if (o.providerRef === undefined) return { ok: false, error: "missing paymentToken" };
      const res = await call<TxnRes>("/api/online/payment/v1/revert", "POST", { paymentToken: o.providerRef });
      return res.ok ? { ok: true } : { ok: false, error: snapppayError(res.code, res.message) };
    },

    async inquiry(o) {
      if (o.providerRef === undefined) return { ok: false };
      const res = await call<TxnRes>(`/api/online/payment/v1/status?paymentToken=${encodeURIComponent(o.providerRef)}`, "GET");
      if (!res.ok) return { ok: false, ...(res.code !== undefined ? { code: res.code } : {}) };
      const status = res.data?.status;
      return { ok: true, ...(typeof status === "string" ? { status } : {}) };
    },

    /**
     * After settle, `cancel` refunds the whole remaining amount. Partial refunds use `update`
     * with the replacement cart and remaining amount supplied by the core refund flow.
     * Manual SnappPay refunds are refused in core so the customer's instalments stay in sync.
     */
    refundsInFullOnly: false,

    async refund(o) {
      if (o.refId === "") return { ok: false, error: "missing paymentToken" };
      if (!o.full && (o.cart === undefined || o.remainingAmount === undefined || o.remainingAmount <= 0)) return { ok: false, error: "partial refund requires the complete remaining basket" };
      const remainingCart = o.cart;
      const remainingAmount = o.remainingAmount;
      if (!o.full && (remainingCart === undefined || remainingAmount === undefined)) return { ok: false, error: "missing remaining basket" };
      const res = o.full || remainingCart === undefined || remainingAmount === undefined
        ? await call<TxnRes>("/api/online/payment/v1/cancel", "POST", { paymentToken: o.refId })
        : await call<TxnRes>("/api/online/payment/v1/update", "POST", {
          ...snapppayCart(remainingCart, remainingAmount, category), paymentToken: o.refId, paymentMethodTypeDto: "INSTALLMENT",
        });
      if (!res.ok) return { ok: false, error: snapppayError(res.code, res.message) };
      return { ok: true, ...(typeof res.data?.transactionId === "string" ? { ref: res.data.transactionId } : {}) };
    },
  };
}
