import { afterEach, describe, expect, it, vi } from "vitest";
import { snapppayCart, snapppayDriver, snapppayMobile } from "../snapppay";
import type { PaymentCart } from "../types";

type Call = { url: string; init: RequestInit | undefined };
const calls: Call[] = [];

const TOKEN_BODY = { access_token: "jwt-abc", token_type: "bearer", expires_in: 3600, scope: "online-merchant" };

/** Answers the OAuth call first, then hands `body` to whatever the driver asks for next. */
function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const isToken = String(url).endsWith("/api/online/v1/oauth/token");
      return new Response(JSON.stringify(isToken ? TOKEN_BODY : body), {
        status: isToken ? 200 : status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

const cfg = { baseUrl: "https://api.snapppay.ir", clientId: "cid", clientSecret: "csecret", username: "u", password: "p" };
const cart: PaymentCart = {
  items: [
    { id: 11, name: "یخچال ساید بای ساید", unitPrice: 40_000_000, qty: 1 },
    { id: 12, name: "مایکروویو", unitPrice: 5_000_000, qty: 2 },
  ],
  itemsTotal: 50_000_000,
  discount: 1_000_000,
  shipping: 500_000,
  tax: 0,
};
const req = { amount: 49_500_000, description: "سفارش NL-7Q2F4", callbackUrl: "https://namilux.ir/api/payment/callback/snapppay", orderCode: "NL-7Q2F4", mobile: "09121234567", cart };

const bodyOf = (i: number): Record<string, unknown> => JSON.parse(calls[i]?.init?.body as string) as Record<string, unknown>;

describe("snapppay mobile", () => {
  it("normalises what our orders actually store", () => {
    expect(snapppayMobile("09121234567")).toBe("+989121234567");
    expect(snapppayMobile("9121234567")).toBe("+989121234567");
    expect(snapppayMobile("+989121234567")).toBe("+989121234567");
    expect(snapppayMobile("00989121234567")).toBe("+989121234567");
    expect(snapppayMobile("021-1234567")).toBeUndefined();
    expect(snapppayMobile(undefined)).toBeUndefined();
  });
});

describe("snapppay cart", () => {
  it("is Rial throughout and reconciles gross − discount = payable", () => {
    const built = snapppayCart(cart, 49_500_000, "لوازم خانگی");
    // gross = 50,000,000 items + 500,000 shipping = 50,500,000 Toman
    expect(built["amount"]).toBe(495_000_000);
    expect(built["discountAmount"]).toBe(10_000_000);
    const list = built["cartList"] as { totalAmount: number; shippingAmount: number; isShipmentIncluded: boolean; cartItems: { amount: number; count: number }[] }[];
    // Official gateway v1.4.2 sends the final payable as cartList.totalAmount.
    expect(list[0]?.totalAmount).toBe(495_000_000);
    expect(list[0]?.shippingAmount).toBe(5_000_000);
    expect(list[0]?.isShipmentIncluded).toBe(true);
    // amount is the PER-UNIT price, count carries the quantity
    expect(list[0]?.cartItems[1]).toMatchObject({ amount: 50_000_000, count: 2 });
    expect((built["amount"] as number) + (built["discountAmount"] as number)).toBe(505_000_000);
  });
});

describe("snapppay driver", () => {
  it("mints a fresh JWT with Basic auth and a form body for every operation (SnappPay: do not cache it)", async () => {
    stubFetch({ successful: true, response: { eligible: true } });
    const d = snapppayDriver(cfg);
    await d.eligible?.({ amount: 1_000_000 });
    await d.eligible?.({ amount: 2_000_000 });

    expect(calls[0]?.url).toBe("https://api.snapppay.ir/api/online/v1/oauth/token");
    const auth = (calls[0]?.init?.headers as Record<string, string>)["authorization"];
    expect(auth).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    expect(calls[0]?.init?.body as string).toBe("grant_type=password&scope=online-merchant&username=u&password=p");
    // Four calls: each eligible mints its own token first.
    expect(calls).toHaveLength(4);
    expect(calls[2]?.url).toBe("https://api.snapppay.ir/api/online/v1/oauth/token");
    expect(calls[3]?.url).toBe("https://api.snapppay.ir/api/online/offer/v1/eligible?amount=20000000");
  });

  it("eligible=false hides the option", async () => {
    stubFetch({ successful: true, response: { eligible: false, title_message: "مبلغ سفارش کمتر از حد اقساط است" } });
    const r = await snapppayDriver(cfg).eligible?.({ amount: 100_000 });
    expect(r).toEqual({ ok: false, message: "مبلغ سفارش کمتر از حد اقساط است" });
  });

  it("request sends the cart in Rial and returns the token as providerRef", async () => {
    stubFetch({ successful: true, response: { paymentToken: "PT-1", paymentPageUrl: "https://pay.snapppay.ir/PT-1" } });
    const r = await snapppayDriver(cfg).request(req);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.redirectUrl).toBe("https://pay.snapppay.ir/PT-1");
      expect(r.providerRef).toBe("PT-1");
      // The authority is ours and carries the order code, so the callback can be traced by eye.
      // 5–10 characters (SnappPay §5): the order code's five, then five random.
      expect(r.authority).toMatch(/^7Q2F4[A-Z2-9]{5}$/);
    }
    const body = bodyOf(1);
    expect(body["amount"]).toBe(495_000_000);
    expect(body["paymentMethodTypeDto"]).toBe("INSTALLMENT");
    expect(body["returnURL"]).toBe(req.callbackUrl);
    expect(body["mobile"]).toBe("+989121234567");
    expect(body["externalSourceAmount"]).toBe(0);
    // §6: the documented default commission type on every item.
    const items = ((body["cartList"] as Record<string, unknown>[])[0]?.["cartItems"] ?? []) as Record<string, unknown>[];
    expect(items.every((it) => it["commissionType"] === 100)).toBe(true);
  });

  it("an RBAC/IP rejection is a not-ok request, never a throw", async () => {
    // Verbatim what api.snapppay.ir answers from an address that is not on the allow-list: a plain
    // 403 from their Envoy gateway. It lands on the token call - the first thing every method does - 
    // so the driver reports an auth failure and checkout shows «اتصال به درگاه ممکن نشد».
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        calls.push({ url: String(url), init: undefined });
        return new Response("RBAC: access denied", { status: 403, headers: { "content-type": "text/plain" } });
      }),
    );
    const r = await snapppayDriver(cfg).request(req);
    expect(r).toEqual({ ok: false, error: "snapppay token: authentication failed" });
    expect(calls[0]?.url).toBe("https://api.snapppay.ir/api/online/v1/oauth/token");
  });

  it("parses the POSTed callback form", () => {
    const d = snapppayDriver(cfg);
    expect(d.parseCallback?.({ transactionId: "NL-1-ABC", state: "OK", amount: "495000000" })).toEqual({ authority: "NL-1-ABC", ok: true });
    expect(d.parseCallback?.({ transactionId: "NL-1-ABC", state: "FAILED" })).toEqual({ authority: "NL-1-ABC", ok: false });
  });

  it("verify holds rather than captures, so it asks for a settle", async () => {
    stubFetch({ successful: true, response: { transactionId: "NL-1-ABC" } });
    const v = await snapppayDriver(cfg).verify({ amount: 49_500_000, authority: "NL-1-ABC", providerRef: "PT-1" });
    expect(v).toEqual({ ok: true, refId: "PT-1", alreadyVerified: false, needsSettle: true });
    expect(calls[1]?.url).toBe("https://api.snapppay.ir/api/online/payment/v1/verify");
    expect(bodyOf(1)).toEqual({ paymentToken: "PT-1" });
  });

  it("verify without the payment token cannot proceed", async () => {
    stubFetch({ successful: true, response: {} });
    const v = await snapppayDriver(cfg).verify({ amount: 1, authority: "NL-1-ABC" });
    expect(v).toEqual({ ok: false, error: "missing paymentToken" });
  });

  it("settle and revert both key on the payment token", async () => {
    stubFetch({ successful: true, response: { transactionId: "NL-1-ABC" } });
    const d = snapppayDriver(cfg);
    expect(await d.settle?.({ authority: "NL-1-ABC", providerRef: "PT-1" })).toEqual({ ok: true });
    expect(calls[1]?.url).toBe("https://api.snapppay.ir/api/online/payment/v1/settle");
    expect(await d.reverse?.({ authority: "NL-1-ABC", providerRef: "PT-1" })).toEqual({ ok: true });
    expect(calls[3]?.url).toBe("https://api.snapppay.ir/api/online/payment/v1/revert");
  });

  it("a documented error code becomes its Persian message", async () => {
    stubFetch({ successful: false, errorData: { errorCode: 1011, message: "Invalid transaction status", data: null } }, 400);
    const r = await snapppayDriver(cfg).settle?.({ authority: "NL-1-ABC", providerRef: "PT-1" });
    expect(r).toEqual({ ok: false, error: "وضعیت تراکنش برای این عملیات معتبر نیست" });
  });

  it("refund is cancel, and only for the whole order", async () => {
    stubFetch({ successful: true, response: { transactionId: "NL-1-ABC" } });
    const d = snapppayDriver(cfg);
    const partial = await d.refund?.({ refId: "PT-1", amount: 1_000_000, reason: "r", full: false });
    expect(partial?.ok).toBe(false);
    // Rejected before any network call: only the token mint happened.
    expect(calls.filter((c) => c.url.includes("/cancel"))).toHaveLength(0);

    const whole = await d.refund?.({ refId: "PT-1", amount: 49_500_000, reason: "r", full: true });
    expect(whole).toEqual({ ok: true, ref: "NL-1-ABC" });
    expect(calls.at(-1)?.url).toBe("https://api.snapppay.ir/api/online/payment/v1/cancel");
  });

  it("partial refunds update the remaining payable and complete cart, never cancel", async () => {
    stubFetch({ successful: true, response: { transactionId: "TX-update" } });
    const result = await snapppayDriver(cfg).refund?.({ refId: "PT-1", amount: 1_000_000, reason: "price adjustment", full: false, cart, remainingAmount: 48_500_000 });
    expect(result?.ok).toBe(true);
    expect(calls.at(-1)?.url.endsWith("/api/online/payment/v1/update")).toBe(true);
    const body = bodyOf(1);
    expect(body).toMatchObject({ amount: 485_000_000, discountAmount: 20_000_000, paymentToken: "PT-1", paymentMethodTypeDto: "INSTALLMENT" });
    expect((body["cartList"] as { cartItems: unknown[] }[])[0]?.cartItems).toHaveLength(2);
    expect(calls.some((c) => c.url.endsWith("/cancel"))).toBe(false);
  });

  it("a timed-out settlement reconciles the official SETTLE status without resending", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/oauth/token")) return new Response(JSON.stringify(TOKEN_BODY));
      if (String(url).endsWith("/settle")) throw new Error("socket closed after provider accepted");
      return new Response(JSON.stringify({ successful: true, response: { status: "SETTLE" } }));
    }));
    expect(await snapppayDriver(cfg).settle?.({ authority: "TX-1", providerRef: "PT-1" })).toEqual({ ok: true });
    expect(calls.filter((c) => c.url.endsWith("/settle"))).toHaveLength(1);
  });

  it("duplicate verify recovers VERIFY and SETTLE using the stored token", async () => {
    for (const status of ["VERIFY", "SETTLE"]) {
      vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
        const path = String(url);
        if (path.endsWith("/oauth/token")) return new Response(JSON.stringify(TOKEN_BODY));
        if (path.endsWith("/verify")) return new Response(JSON.stringify({ successful: false, errorData: { errorCode: 1011 } }), { status: 400 });
        return new Response(JSON.stringify({ successful: true, response: { status } }));
      }));
      expect(await snapppayDriver(cfg).verify({ amount: req.amount, authority: "TX-1", providerRef: "PT-1" })).toMatchObject({ ok: true, refId: "PT-1", alreadyVerified: true, needsSettle: status === "VERIFY" });
    }
  });

  it("a dead gateway is a not-ok result, not an exception", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }),
    );
    const d = snapppayDriver(cfg);
    const r = await d.request(req);
    expect(r.ok).toBe(false);
    expect(await d.eligible?.({ amount: 1 })).toMatchObject({ ok: false });
  });

  it("refuses to start a payment without a mobile number (SnappPay requires it)", async () => {
    stubFetch({ successful: true, response: { paymentToken: "PT-1", paymentPageUrl: "https://pay.snapppay.ir/PT-1" } });
    const r = await snapppayDriver(cfg).request({ amount: 1_000, orderCode: "NL-7Q2F4", callbackUrl: "https://namilux.ir/api/payment/callback/snapppay", description: "x", mobile: "abc" });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("verify: no answer then PENDING → verify again (§11)", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = String(url);
      calls.push({ url: u, init: undefined });
      if (u.endsWith("/oauth/token")) return new Response(JSON.stringify({ access_token: "jwt", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
      if (u.includes("/verify")) { n++; return n === 1 ? new Response(JSON.stringify({ successful: false, errorData: { errorCode: 1000 } }), { status: 500, headers: { "content-type": "application/json" } }) : new Response(JSON.stringify({ successful: true, response: { transactionId: "X" } }), { status: 200, headers: { "content-type": "application/json" } }); }
      return new Response(JSON.stringify({ successful: true, response: { status: "PENDING" } }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const v = await snapppayDriver(cfg).verify({ amount: 1, authority: "A", providerRef: "PT-1" });
    expect(v).toMatchObject({ ok: true, needsSettle: true });
    expect(calls.filter((c) => c.url.includes("/verify"))).toHaveLength(2);
  });

  it("settle: false then VERIFY → settle again (§12)", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      const u = String(url);
      calls.push({ url: u, init: undefined });
      if (u.endsWith("/oauth/token")) return new Response(JSON.stringify({ access_token: "jwt", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } });
      if (u.includes("/settle")) { n++; return n === 1 ? new Response(JSON.stringify({ successful: false }), { status: 500, headers: { "content-type": "application/json" } }) : new Response(JSON.stringify({ successful: true, response: {} }), { status: 200, headers: { "content-type": "application/json" } }); }
      return new Response(JSON.stringify({ successful: true, response: { status: "VERIFY" } }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    expect(await snapppayDriver(cfg).settle?.({ authority: "A", providerRef: "PT-1" })).toEqual({ ok: true });
    expect(calls.filter((c) => c.url.includes("/settle"))).toHaveLength(2);
  });
});
