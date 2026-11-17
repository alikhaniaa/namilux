import { afterEach, describe, expect, it, vi } from "vitest";
import { zarinpalDriver, zarinpalError } from "../zarinpal";

type Call = { url: string; init: RequestInit | undefined };
const calls: Call[] = [];

function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }),
  );
}

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

const cfg = { merchantId: "00000000-0000-0000-0000-000000000000", sandbox: true };
const req = { amount: 41_500_000, description: "سفارش NL-7Q2F4 — نامی‌لوکس", callbackUrl: "https://namilux.ir/api/payment/callback/zarinpal", orderCode: "NL-7Q2F4", mobile: "09121234567" };

describe("zarinpal driver", () => {
  it("explains the actual provider amount limit without hardcoding a local cap", async () => {
    stubFetch(422, { errors: { code: -9, message: "The amount may not be greater than 100000000" } });
    const result = await zarinpalDriver(cfg).request({ ...req, amount: 140_000_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.customerMessage).toContain("۱۰۰٬۰۰۰٬۰۰۰");
    expect(calls).toHaveLength(1);
  });

  it("request body always has currency IRT", async () => {
    stubFetch(200, { data: { code: 100, authority: "A0000000000000000000000000000000001" } });
    await zarinpalDriver(cfg).request(req);
    const body = JSON.parse(calls[0]?.init?.body as string) as { currency: string; amount: number; merchant_id: string; metadata: { order_id: string } };
    expect(body.currency).toBe("IRT");
    expect(body.amount).toBe(41_500_000);
    expect(body.merchant_id).toBe(cfg.merchantId);
    expect(body.metadata.order_id).toBe("NL-7Q2F4");
    expect(calls[0]?.url).toBe("https://sandbox.zarinpal.com/pg/v4/payment/request.json");
  });

  it("code 100 → ok with authority", async () => {
    stubFetch(200, { data: { code: 100, authority: "A000X" } });
    const r = await zarinpalDriver({ ...cfg, sandbox: false }).request(req);
    expect(r).toEqual({ ok: true, authority: "A000X", redirectUrl: "https://payment.zarinpal.com/pg/StartPay/A000X" });
  });

  it("verify 101 → alreadyVerified", async () => {
    stubFetch(200, { data: { code: 101, ref_id: 123456, card_pan: "603799******1234", fee: 15000 } });
    const v = await zarinpalDriver(cfg).verify({ amount: 41_500_000, authority: "A000X" });
    expect(v).toEqual({ ok: true, refId: "123456", alreadyVerified: true, cardPan: "603799******1234", fee: 15000 });
    const body = JSON.parse(calls[0]?.init?.body as string) as { amount: number; authority: string };
    expect(body).toMatchObject({ amount: 41_500_000, authority: "A000X" });
  });

  it("-51 → not ok with code and the Persian reason", async () => {
    stubFetch(200, { data: { code: -51 } });
    const v = await zarinpalDriver(cfg).verify({ amount: 1, authority: "A000X" });
    expect(v).toEqual({ ok: false, code: -51, error: "پرداخت ناموفق بود" });
  });

  it("an errors-shaped failure body still yields the code", async () => {
    // 422 with {errors:{authority:["Invalid authority.","-54"]}} is what a bad authority really returns.
    stubFetch(422, { message: "Invalid authority", errors: { authority: ["Invalid authority.", "-54"] } });
    const v = await zarinpalDriver(cfg).verify({ amount: 1, authority: "nope" });
    expect(v).toEqual({ ok: false, code: -54, error: "کد پیگیری (Authority) نامعتبر است" });
  });

  it("timeout → not ok", async () => {
    // AbortSignal.timeout fires an AbortError inside fetch; the driver must turn it into a not-ok
    // result rather than let it escape into the checkout transaction.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }),
    );
    const r = await zarinpalDriver(cfg).request(req);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/failed/);
    const v = await zarinpalDriver(cfg).verify({ amount: 1, authority: "A000X" });
    expect(v).toEqual({ ok: false, error: "transport" });
  });

  it("inquiry reports the gateway status without verifying", async () => {
    stubFetch(200, { data: { status: "PAID", code: 100, message: "Success" } });
    const r = await zarinpalDriver(cfg).inquiry?.({ authority: "A000X" });
    expect(r).toEqual({ ok: true, status: "PAID", code: 100 });
    expect(calls[0]?.url).toBe("https://sandbox.zarinpal.com/pg/v4/payment/inquiry.json");
  });

  it("reverse maps -62 (terminal ip not set) to its Persian reason", async () => {
    stubFetch(200, { data: {}, errors: { message: "Terminal ip limit most be active.", code: -62, validations: [] } });
    const r = await zarinpalDriver(cfg).reverse?.({ authority: "A000X" });
    expect(r).toEqual({ ok: false, error: "آی‌پی درگاه تنظیم نشده است" });
  });

  it("unVerified accepts the string code the endpoint really sends", async () => {
    stubFetch(200, { data: { code: "100", message: "Success", authorities: [{ authority: "A1", amount: 50500, callback_url: "x", referer: "y", date: "2020-07-01 17:33:25" }] } });
    const r = await zarinpalDriver(cfg).unverified?.();
    expect(r).toEqual({ ok: true, authorities: [{ authority: "A1", amount: 50500, date: "2020-07-01 17:33:25" }] });
  });

  it("feeCalculation asks in Toman", async () => {
    stubFetch(200, { data: { amount: 100000, fee: 4200, fee_type: "Merchant", suggested_amount: 104329, code: 100 } });
    const r = await zarinpalDriver(cfg).feeCalculation?.(100_000);
    expect(r).toEqual({ ok: true, fee: 4200, feeType: "Merchant", suggestedAmount: 104329 });
    const body = JSON.parse(calls[0]?.init?.body as string) as { amount: number; currency: string };
    expect(body).toMatchObject({ amount: 100_000, currency: "IRT" });
  });

  it("refund needs a terminal id, converts Toman to Rial and enforces the 20,000 Rial floor", async () => {
    stubFetch(200, {});
    const noTerminal = await zarinpalDriver({ ...cfg, accessToken: "t" }).refund?.({ refId: "1", amount: 5_000, reason: "r", full: true });
    expect(noTerminal).toEqual({ ok: false, error: "ZARINPAL_TERMINAL_ID is not set" });

    const withTerminal = zarinpalDriver({ ...cfg, accessToken: "t", terminalId: "100001" });
    const tooSmall = await withTerminal.refund?.({ refId: "1", amount: 1_999, reason: "r", full: true });
    expect(tooSmall?.ok).toBe(false);

    calls.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        const body = (init?.body ?? "") as string;
        // First the session lookup by reference_id, then the AddRefund mutation.
        const payload = body.includes("AddRefund")
          ? { data: { resource: { terminal_id: "100001", id: "300000001", amount: 20000, timeline: { refund_amount: 20000, refund_time: "t", refund_status: "PENDING" } } } }
          : { data: { Session: [{ id: "800000001" }] } };
        return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const ok = await withTerminal.refund?.({ refId: "201", amount: 2_000, reason: "درخواست خریدار", full: true });
    // PAYA lands next cycle, so PENDING counts as accepted.
    expect(ok).toEqual({ ok: true, ref: "300000001" });
    expect(calls[0]?.url).toBe("https://next.zarinpal.com/api/v4/graphql");
    const mutation = JSON.parse(calls[1]?.init?.body as string) as { variables: { session_id: string; amount: number; method: string } };
    expect(mutation.variables).toMatchObject({ session_id: "800000001", amount: 20_000, method: "PAYA" });
  });

  it("the panel access token never reaches the gateway host", async () => {
    // pg/v4 is authenticated by merchant_id; the OAuth token belongs to next.zarinpal.com only.
    stubFetch(200, { data: { code: 100, authority: "A000X" } });
    await zarinpalDriver({ ...cfg, accessToken: "panel-token", terminalId: "100001" }).request(req);
    const sent = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(Object.keys(sent ?? {}).map((k) => k.toLowerCase())).not.toContain("authorization");
    expect(JSON.stringify(sent)).not.toContain("panel-token");
  });

  it("a coded request failure carries the code and its Persian reason", async () => {
    stubFetch(200, { data: {}, errors: { message: "Validation error", code: -9, validations: [] } });
    const r = await zarinpalDriver(cfg).request(req);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("-9");
      expect(r.error).toContain(zarinpalError(-9));
    }
  });

  it("reverse is never fired twice, while verify keeps its retries", async () => {
    // A reverse whose response was lost may already have landed: re-sending it answers -61 and we
    // would report a failure for money that did go back. verify is idempotent (101), so it retries.
    const fetchMock = vi.fn(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    vi.stubGlobal("fetch", fetchMock);
    const d = zarinpalDriver(cfg);
    expect(await d.reverse?.({ authority: "A000X" })).toEqual({ ok: false, error: "transport" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    await d.verify({ amount: 1, authority: "A000X" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("a refund that times out is not retried", async () => {
    // httpJson retries twice by default; on AddRefund that would pay the shopper up to three times.
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      // `init.body` is BodyInit - only the string case is ever sent here, and narrowing to it keeps
      // the rule against stringifying an object satisfied without weakening the assertion.
      const sent = typeof init?.body === "string" ? init.body : "";
      if (sent.includes("AddRefund")) throw new DOMException("timeout", "TimeoutError");
      return new Response(JSON.stringify({ data: { Session: [{ id: "800000001" }] } }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await zarinpalDriver({ ...cfg, accessToken: "t", terminalId: "100001" }).refund?.({ refId: "201", amount: 2_000, reason: "r", full: true });
    expect(r?.ok).toBe(false);
    // one session lookup (safe to retry, and it did not fail) + exactly one AddRefund attempt.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
