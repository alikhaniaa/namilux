import { faInt } from "@namilux/core/client";
import { httpJson } from "../http";
import type { PaymentDriver } from "./types";

/**
 * The published error table (zarinpal.com/docs/paymentGateway/errorList), Persian side. Anything not
 * listed falls back to a generic message - the shopper must never see an English gateway string.
 */
export const ZARINPAL_ERRORS: Record<number, string> = {
  [-9]: "خطای اعتبارسنجی درخواست",
  [-10]: "آی‌پی یا کد پذیرنده درست نیست",
  [-11]: "کد پذیرنده فعال نیست",
  [-12]: "تلاش بیش از حد مجاز در بازهٔ کوتاه",
  [-13]: "محدودیت تراکنش درگاه",
  [-14]: "نشانی بازگشت با دامنهٔ ثبت‌شدهٔ درگاه هم‌خوانی ندارد",
  [-15]: "درگاه پرداخت معلق شده است",
  [-16]: "سطح تأیید پذیرنده کافی نیست",
  [-17]: "محدودیت پذیرنده در سطح آبی",
  [-18]: "نشانی ارجاع‌دهنده با دامنهٔ ثبت‌شده هم‌خوانی ندارد",
  [-19]: "تراکنش برای این ترمینال مجاز نیست",
  [-30]: "دسترسی به تسویهٔ اشتراکی شناور وجود ندارد",
  [-31]: "حساب بانکی تسویه در پنل ثبت نشده است",
  [-32]: "مبلغ تسهیم از مبلغ کل تراکنش بیشتر است",
  [-33]: "درصدهای تسهیم درست نیست",
  [-34]: "مبلغ تسهیم از مبلغ کل تراکنش بیشتر است",
  [-35]: "تعداد دریافت‌کنندگان تسهیم بیش از حد مجاز است",
  [-36]: "حداقل مبلغ تسهیم ۱۰٬۰۰۰ ریال است",
  [-37]: "یک یا چند شبای تسهیم از سمت بانک غیرفعال است",
  [-38]: "شبا درست تعریف نشده است؛ کمی بعد دوباره تلاش کنید",
  [-39]: "خطا در تسهیم",
  [-40]: "مقدار expire_in معتبر نیست",
  [-41]: "حداکثر مبلغ پرداختی ۱۰۰ میلیون تومان است",
  [-50]: "مبلغ پرداخت‌شده با مبلغ درخواست هم‌خوانی ندارد",
  [-51]: "پرداخت ناموفق بود",
  [-52]: "خطای غیرمنتظره در درگاه",
  [-53]: "این پرداخت متعلق به این کد پذیرنده نیست",
  [-54]: "کد پیگیری (Authority) نامعتبر است",
  [-55]: "تراکنش پیدا نشد",
  [-60]: "امکان ریورس این تراکنش با بانک وجود ندارد",
  [-61]: "تراکنش موفق نیست یا پیش‌تر ریورس شده است",
  [-62]: "آی‌پی درگاه تنظیم نشده است",
  [-63]: "مهلت ۳۰ دقیقه‌ای ریورس این تراکنش گذشته است",
  [100]: "عملیات موفق",
  [101]: "تراکنش پیش‌تر اعتبارسنجی شده است",
};

export function zarinpalError(code: number | undefined): string {
  if (code === undefined) return "خطای نامشخص درگاه";
  return ZARINPAL_ERRORS[code] ?? `خطای درگاه (${String(code)})`;
}

/** Statuses inquiry.json reports. Never a substitute for verify - the docs say so explicitly. */
export type ZarinpalStatus = "VERIFIED" | "PAID" | "IN_BANK" | "FAILED" | "REVERSED";

type ZErrors = { code?: number; message?: string } | unknown[];
type ZReq = { data?: { code?: number; authority?: string; fee?: number; fee_type?: string }; errors?: ZErrors };
type ZVerify = { data?: { code?: number; ref_id?: number | string; card_pan?: string; card_hash?: string; fee?: number }; errors?: ZErrors };
type ZInquiry = { data?: { code?: number; status?: string; message?: string }; errors?: ZErrors };
type ZReverse = { data?: { code?: number; message?: string }; errors?: ZErrors };
type ZUnverified = { data?: { code?: number | string; authorities?: { authority: string; amount: number; callback_url: string; referer: string; date: string }[] }; errors?: ZErrors };
type ZFee = { data?: { code?: number; amount?: number; fee?: number; fee_type?: string; suggested_amount?: number }; errors?: ZErrors };

type ZBody = { data?: { code?: number | string }; errors?: ZErrors };

/**
 * ZarinPal reports failures either as `data.code` or as `errors.code`, and unVerified.json returns
 * its code as the STRING "100" while every other method uses a number - so both are accepted.
 */
function codeOf(body: ZBody | null): number | undefined {
  const dataCode = body?.data?.code;
  if (typeof dataCode === "number") return dataCode;
  if (typeof dataCode === "string" && dataCode !== "" && Number.isFinite(Number(dataCode))) return Number(dataCode);
  const errors = body?.errors;
  if (errors !== null && errors !== undefined && !Array.isArray(errors) && typeof errors === "object") {
    const c = (errors as { code?: unknown }).code;
    if (typeof c === "number") return c;
    // Field-validation errors arrive as {authority: ["Invalid authority.", "-54"]}.
    for (const v of Object.values(errors as Record<string, unknown>)) {
      if (!Array.isArray(v)) continue;
      const last: unknown = (v as unknown[]).at(-1);
      const n = typeof last === "string" ? Number(last) : typeof last === "number" ? last : NaN;
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

const REFUND_MIN_RIAL = 20_000;
const RIAL_PER_TOMAN = 10;

export type ZarinpalConfig = {
  merchantId: string;
  sandbox: boolean;
  /** OAuth access token from next.zarinpal.com - refunds only. */
  accessToken?: string;
  /** Terminal id, needed to resolve a ref_id back to the session id a refund takes. */
  terminalId?: string;
};

export function zarinpalDriver(cfg: ZarinpalConfig): PaymentDriver {
  const host = cfg.sandbox ? "https://sandbox.zarinpal.com" : "https://payment.zarinpal.com";
  const api = `${host}/pg/v4/payment`;
  const graphql = "https://next.zarinpal.com/api/v4/graphql";
  const startPay = (authority: string): string => `${host}/pg/StartPay/${authority}`;
  // pg/v4 authenticates on merchant_id alone - the docs define no Authorization header for it, so the
  // panel OAuth token stays on next.zarinpal.com and never reaches the gateway host.
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };

  /**
   * POST a pg/v4 method. A transport failure is a null body, never a throw. `retries` defaults to
   * httpJson's 2, which is right for the read-only and idempotent methods; a money-moving call passes
   * 0, because a retry after a timeout would fire the same operation a second time.
   */
  async function post<T extends ZBody>(path: string, body: Record<string, unknown>, retries?: number): Promise<{ body: T | null; status: number }> {
    try {
      const res = await httpJson<T>(`${api}/${path}`, {
        method: "POST",
        headers,
        timeoutMs: 15_000,
        ...(retries === undefined ? {} : { retries }),
        body: JSON.stringify({ merchant_id: cfg.merchantId, ...body }),
      });
      return { body: res.data, status: res.status };
    } catch {
      return { body: null, status: 0 };
    }
  }

  /** The panel API (next.zarinpal.com) is GraphQL and Bearer-authenticated; only refunds use it. */
  async function gql<T>(query: string, variables: Record<string, unknown>, retries = 2): Promise<{ data: T | null; error?: string }> {
    if (cfg.accessToken === undefined) return { data: null, error: "ZARINPAL_ACCESS_TOKEN is not set" };
    try {
      const res = await httpJson<{ data?: T; errors?: { message?: string }[] }>(graphql, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${cfg.accessToken}` },
        timeoutMs: 20_000,
        retries,
        body: JSON.stringify({ query, variables }),
      });
      const first = res.data?.errors?.[0]?.message;
      if (typeof first === "string") return { data: null, error: first };
      return { data: res.data?.data ?? null };
    } catch (err) {
      return { data: null, error: err instanceof Error ? err.name : "graphql request failed" };
    }
  }

  return {
    key: "zarinpal",

    async request(o) {
      // currency: "IRT" is MANDATORY - omitting it charges Rials (1/10 of the intended Toman).
      // A transport failure (timeout, DNS, 5xx after retries) is a not-ok result, not a throw: core
      // startPayment records it as request_failed and the shopper gets «پرداخت دوباره».
      const { body, status } = await post<ZReq>("request.json", {
        amount: o.amount,
        currency: "IRT",
        callback_url: o.callbackUrl,
        description: o.description,
        metadata: { ...(o.mobile !== undefined ? { mobile: o.mobile } : {}), order_id: o.orderCode },
      }, 0);
      const code = codeOf(body);
      const authority = body?.data?.authority;
      if (code === 100 && typeof authority === "string") {
        return { ok: true, authority, redirectUrl: startPay(authority) };
      }
      if (body === null) return { ok: false, error: "zarinpal request failed: transport" };
      // Use the provider's current limit, rather than freezing a merchant limit in our code.
      const providerMessage = !Array.isArray(body.errors) ? body.errors?.message : undefined;
      const maximum = typeof providerMessage === "string" ? /amount may not be greater than (\d+)/i.exec(providerMessage)?.[1] : undefined;
      const limit = maximum === undefined ? NaN : Number(maximum);
      const customerMessage = code === -9 && Number.isSafeInteger(limit) && limit > 0
        ? `زرین‌پال سقف این پرداخت را ${faInt(limit)} تومان اعلام کرده است. مبلغ سفارش از این سقف بیشتر است؛ برای هماهنگی پرداخت با پشتیبانی فروشگاه تماس بگیرید.`
        : undefined;
      return { ok: false, error: `zarinpal request code ${String(code ?? status)}: ${zarinpalError(code)}${customerMessage === undefined ? "" : `; amount_max_irt=${limit}`}`, ...(customerMessage === undefined ? {} : { customerMessage }) };
    },

    async verify(o) {
      const { body } = await post<ZVerify>("verify.json", { amount: o.amount, authority: o.authority });
      // Unreachable gateway: the callback treats a not-ok verify as failed and logs it; a retry
      // of the verify (code 101) is idempotent on the gateway side.
      if (body === null) return { ok: false, error: "transport" };
      const data = body.data;
      const code = codeOf(body);
      if (code === 100 || code === 101) {
        const result: { ok: true; refId: string; cardPan?: string; fee?: number; alreadyVerified: boolean } = {
          ok: true,
          refId: String(data?.ref_id ?? ""),
          alreadyVerified: code === 101,
        };
        if (typeof data?.card_pan === "string") result.cardPan = data.card_pan;
        if (typeof data?.fee === "number") result.fee = data.fee;
        return result;
      }
      return { ok: false, ...(typeof code === "number" ? { code } : {}), error: zarinpalError(code) };
    },

    /**
     * Status probe only. ZarinPal is explicit: never treat this as a verify - it reports what the
     * gateway thinks, and does not move the transaction on.
     */
    async inquiry(o) {
      const { body } = await post<ZInquiry>("inquiry.json", { authority: o.authority });
      if (body === null) return { ok: false };
      const code = codeOf(body);
      const status = body.data?.status;
      if (code === 100 && typeof status === "string") return { ok: true, status, code };
      return { ok: false, ...(typeof code === "number" ? { code } : {}) };
    },

    /**
     * Refund a *successful* charge inside the 30-minute window, free of the gateway fee. Requires the
     * terminal's server IP to be registered in the panel; without it ZarinPal answers -62.
     */
    async reverse(o) {
      // retries 0: a reverse whose response was lost may already have landed, and a blind retry
      // would come back -61 and report a failure for money that did go back.
      const { body } = await post<ZReverse>("reverse.json", { authority: o.authority }, 0);
      if (body === null) return { ok: false, error: "transport" };
      const code = codeOf(body);
      if (code === 100) return { ok: true };
      return { ok: false, error: zarinpalError(code) };
    },

    /**
     * Money taken but never verified - the reconciliation list. ZarinPal returns at most the last 100
     * and drops these back to the shopper if the merchant never verifies them.
     */
    async unverified(): Promise<{ ok: boolean; authorities: { authority: string; amount: number; date: string }[] }> {
      const { body } = await post<ZUnverified>("unVerified.json", {});
      if (body === null) return { ok: false, authorities: [] };
      const rows = body.data?.authorities ?? [];
      if (codeOf(body) !== 100) return { ok: false, authorities: [] };
      return { ok: true, authorities: rows.map((r) => ({ authority: r.authority, amount: r.amount, date: r.date })) };
    },

    /** What the gateway will take on an amount, before a transaction exists. Toman in, Toman out. */
    async feeCalculation(amount: number): Promise<{ ok: boolean; fee?: number; feeType?: string; suggestedAmount?: number }> {
      const { body } = await post<ZFee>("feeCalculation.json", { amount, currency: "IRT" });
      if (body === null) return { ok: false };
      const code = codeOf(body);
      if (code !== 100) return { ok: false };
      const d = body.data;
      return {
        ok: true,
        ...(typeof d?.fee === "number" ? { fee: d.fee } : {}),
        ...(typeof d?.fee_type === "string" ? { feeType: d.fee_type } : {}),
        ...(typeof d?.suggested_amount === "number" ? { suggestedAmount: d.suggested_amount } : {}),
      };
    },

    /**
     * A refund goes through the panel's GraphQL API, not the pg/v4 gateway, and it is keyed on the
     * *session* id - not the ref_id we store. So: look the session up by reference_id, then AddRefund.
     * Every amount on this API is Rial, while our orders are Toman, hence the ×10.
     * method CARD is instant; PAYA lands in the next settlement cycle.
     */
    async refund(o) {
      if (cfg.terminalId === undefined) return { ok: false, error: "ZARINPAL_TERMINAL_ID is not set" };
      const rial = o.amount * RIAL_PER_TOMAN;
      if (rial < REFUND_MIN_RIAL) return { ok: false, error: `حداقل مبلغ استرداد ${REFUND_MIN_RIAL / RIAL_PER_TOMAN} تومان است` };

      const found = await gql<{ Session?: { id?: string }[] }>(
        "query FindSession($terminal_id: ID, $reference_id: String) { Session(terminal_id: $terminal_id, reference_id: $reference_id) { id } }",
        { terminal_id: cfg.terminalId, reference_id: o.refId },
      );
      if (found.error !== undefined) return { ok: false, error: found.error };
      const sessionId = found.data?.Session?.[0]?.id;
      if (typeof sessionId !== "string") return { ok: false, error: "تراکنش در پنل زرین‌پال پیدا نشد" };

      const added = await gql<{ resource?: { id?: string; timeline?: { refund_status?: string } } }>(
        `mutation AddRefund($session_id: ID!, $amount: BigInteger!, $description: String, $method: InstantPayoutActionTypeEnum, $reason: RefundReasonEnum) {
  resource: AddRefund(session_id: $session_id, amount: $amount, description: $description, method: $method, reason: $reason) {
    id
    timeline { refund_status refund_amount refund_time }
  }
}`,
        { session_id: sessionId, amount: rial, description: o.reason.slice(0, 255), method: "PAYA", reason: "CUSTOMER_REQUEST" },
        0, // never auto-retry a refund: a timeout after ZarinPal accepted it would pay the shopper twice.
      );
      if (added.error !== undefined) return { ok: false, error: added.error };
      const status = added.data?.resource?.timeline?.refund_status;
      // PENDING is the normal answer for a PAYA refund - it settles in the next cycle, so it counts
      // as accepted. Only an outright FAILED (or a missing resource) is a failure here.
      if (status === "SUCCESS" || status === "PENDING") {
        return { ok: true, ...(typeof added.data?.resource?.id === "string" ? { ref: added.data.resource.id } : {}) };
      }
      return { ok: false, error: `refund status ${String(status ?? "unknown")}` };
    },
  };
}
