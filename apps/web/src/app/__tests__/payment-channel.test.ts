import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Core from "@namilux/core";
import type * as CallbackRoute from "../api/payment/callback/[driver]/route";

/**
 * The two payment routes that differ by storefront.
 *
 * Both read the channel at module load (`lib/channel.ts` ← `@/env`), so each case loads them again
 * against a mocked env - the shape `lib/__tests__/http-handler.test.ts` and `seo-channel.test.ts`
 * use, because the real schema needs secrets no test process carries. `@/lib/db` is mocked to a
 * client that throws: neither route may reach the database on the paths exercised here.
 */
const SITE_ORIGIN = "https://namilux.ir";

type EnvOver = Record<string, unknown>;

const BASE_ENV = {
  SITE_ORIGIN,
  APP_ENV: "staging",
  TRUST_PROXY: false,
  INTERNAL_SIGNING_KEY: "k".repeat(64),
  SMS_DRIVER: "farazsms",
};

/**
 * `rows`, when given, is what the one products read (`loadInstalmentEligibility`: select → from →
 * where → orderBy) resolves to; without it the database throws, as before.
 */
async function withEnv<T>(over: EnvOver, fn: () => Promise<T>, rows?: { id: number; instalmentEligible: boolean }[]): Promise<T> {
  vi.resetModules();
  vi.doMock("@/env", () => ({ env: { ...BASE_ENV, ...over } }));
  vi.doMock("@/lib/db", () => ({
    db: {
      select: () => {
        if (rows === undefined) throw new Error("this route must not touch the database");
        const chain = { from: () => chain, where: () => chain, orderBy: async () => rows };
        return chain;
      },
    },
  }));
  vi.doMock("@/lib/session", () => ({
    currentUser: async () => null,
    isRecentlyVerified: () => true,
  }));
  try {
    return await fn();
  } finally {
    vi.doUnmock("@/env");
    vi.doUnmock("@/lib/db");
    vi.doUnmock("@/lib/session");
    vi.resetModules();
  }
}

const post = (url: string, body: unknown): Request =>
  new Request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", origin: SITE_ORIGIN, "sec-fetch-site": "same-origin" },
  });

const noParams = { params: Promise.resolve({}) };

type Envelope = { ok: boolean; data?: { eligible: boolean; applicable: boolean; message?: string; ineligibleProductIds?: number[] } };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/checkout/eligible", () => {
  it("with SnappPay disabled the question does not apply, and nothing leaves the box", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const body = await withEnv({ SITE_MODE: "main", PAYMENT_DRIVER: "zarinpal", ZARINPAL_MERCHANT_ID: "m" }, async () => {
      const { POST } = await import("../api/checkout/eligible/route");
      const res = await POST(post(`${SITE_ORIGIN}/api/checkout/eligible/`, { amount: 40_000_000 }), noParams);
      return (await res.json()) as Envelope;
    });
    expect(body).toEqual({ ok: true, data: { eligible: false, applicable: false } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("under the simulator every basket is eligible, so the main site can exercise both methods", async () => {
    const body = await withEnv({ SITE_MODE: "main", SNAPPPAY_ENABLED: true, PAYMENT_DRIVER: "mock" }, async () => {
      const { POST } = await import("../api/checkout/eligible/route");
      const res = await POST(post(`${SITE_ORIGIN}/api/checkout/eligible/`, { amount: 40_000_000 }), noParams);
      return (await res.json()) as Envelope;
    });
    expect(body.data).toEqual({ eligible: true, applicable: true });
  });

  it("asks SnappPay for the quoted total and passes their refusal message through", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        calls.push(String(url));
        const isToken = String(url).endsWith("/api/online/v1/oauth/token");
        const payload = isToken
          ? { access_token: "jwt", expires_in: 3600 }
          : { successful: true, response: { eligible: false, title_message: "مبلغ سفارش کمتر از حد اقساط است" } };
        return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const body = await withEnv(
      {
        SITE_MODE: "main", SNAPPPAY_ENABLED: true,
        PAYMENT_DRIVER: "snapppay",
        SNAPPPAY_BASE_URL: "https://api.snapppay.ir",
        SNAPPPAY_CLIENT_ID: "c",
        SNAPPPAY_CLIENT_SECRET: "s",
        SNAPPPAY_USERNAME: "u",
        SNAPPPAY_PASSWORD: "p",
      },
      async () => {
        const { POST } = await import("../api/checkout/eligible/route");
        const res = await POST(post(`${SITE_ORIGIN}/api/checkout/eligible/`, { amount: 40_000_000 }), noParams);
        return (await res.json()) as Envelope;
      },
    );
    expect(body.data).toEqual({ eligible: false, applicable: true, message: "مبلغ سفارش کمتر از حد اقساط است" });
    // Toman × 10 - every amount on that API is Rial.
    expect(calls.at(-1)).toBe("https://api.snapppay.ir/api/online/offer/v1/eligible?amount=400000000");
  });

  it("a gateway that cannot answer resolves to 'not offered', never to an error", async () => {
    // Verbatim what an address that is not on SnappPay's allow-list gets back, on the token call.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("RBAC: access denied", { status: 403 })));
    const body = await withEnv(
      {
        SITE_MODE: "main", SNAPPPAY_ENABLED: true,
        PAYMENT_DRIVER: "snapppay",
        SNAPPPAY_BASE_URL: "https://api.snapppay.ir",
        SNAPPPAY_CLIENT_ID: "c",
        SNAPPPAY_CLIENT_SECRET: "s",
        SNAPPPAY_USERNAME: "u",
        SNAPPPAY_PASSWORD: "p",
      },
      async () => {
        const { POST } = await import("../api/checkout/eligible/route");
        const res = await POST(post(`${SITE_ORIGIN}/api/checkout/eligible/`, { amount: 40_000_000 }), noParams);
        return { status: res.status, body: (await res.json()) as Envelope };
      },
    );
    expect(body.status).toBe(200);
    expect(body.body.ok).toBe(true);
    expect(body.body.data?.eligible).toBe(false);
  });

  it("an unconfigured instalment gateway is simply not offered", async () => {
    const body = await withEnv({ SITE_MODE: "main", SNAPPPAY_ENABLED: true, PAYMENT_DRIVER: "snapppay" }, async () => {
      const { POST } = await import("../api/checkout/eligible/route");
      const res = await POST(post(`${SITE_ORIGIN}/api/checkout/eligible/`, { amount: 40_000_000 }), noParams);
      return (await res.json()) as Envelope;
    });
    expect(body.data).toEqual({ eligible: false, applicable: true });
  });

  it("a basket with a product switched off for instalments is refused, naming it, without asking the gateway", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const body = await withEnv(
      { SITE_MODE: "main", SNAPPPAY_ENABLED: true, PAYMENT_DRIVER: "mock" },
      async () => {
        const { POST } = await import("../api/checkout/eligible/route");
        const res = await POST(post(`${SITE_ORIGIN}/api/checkout/eligible/`, { amount: 40_000_000, productIds: [3, 8] }), noParams);
        return (await res.json()) as Envelope;
      },
      [
        { id: 3, instalmentEligible: true },
        { id: 8, instalmentEligible: false },
      ],
    );
    expect(body.data?.eligible).toBe(false);
    expect(body.data?.applicable).toBe(true);
    expect(body.data?.ineligibleProductIds).toEqual([8]);
    expect(typeof body.data?.message).toBe("string");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an all-eligible basket goes on to the gateway's answer", async () => {
    const body = await withEnv(
      { SITE_MODE: "main", SNAPPPAY_ENABLED: true, PAYMENT_DRIVER: "mock" },
      async () => {
        const { POST } = await import("../api/checkout/eligible/route");
        const res = await POST(post(`${SITE_ORIGIN}/api/checkout/eligible/`, { amount: 40_000_000, productIds: [3] }), noParams);
        return (await res.json()) as Envelope;
      },
      [{ id: 3, instalmentEligible: true }],
    );
    expect(body.data).toEqual({ eligible: true, applicable: true });
  });

  it("the main site never reads the switch - card purchase is not an instalment question", async () => {
    const body = await withEnv({ SITE_MODE: "main", PAYMENT_DRIVER: "zarinpal", ZARINPAL_MERCHANT_ID: "m" }, async () => {
      const { POST } = await import("../api/checkout/eligible/route");
      const res = await POST(post(`${SITE_ORIGIN}/api/checkout/eligible/`, { amount: 40_000_000, productIds: [8] }), noParams);
      return (await res.json()) as Envelope;
    });
    expect(body.data).toEqual({ eligible: false, applicable: false });
  });

  it("productIds is bounded: empty or more than a basket can hold is a validation failure", async () => {
    const statuses = await withEnv({ SITE_MODE: "main", SNAPPPAY_ENABLED: true, PAYMENT_DRIVER: "mock" }, async () => {
      const { POST } = await import("../api/checkout/eligible/route");
      const empty = await POST(post(`${SITE_ORIGIN}/api/checkout/eligible/`, { amount: 1, productIds: [] }), noParams);
      const huge = await POST(post(`${SITE_ORIGIN}/api/checkout/eligible/`, { amount: 1, productIds: Array.from({ length: 21 }, (_, i) => i + 1) }), noParams);
      return [empty.status, huge.status];
    });
    expect(statuses).toEqual([400, 400]);
  });

  it("the body is strict: an unknown field is a validation failure, not a silently ignored one", async () => {
    const res = await withEnv({ SITE_MODE: "main", SNAPPPAY_ENABLED: true, PAYMENT_DRIVER: "mock" }, async () => {
      const { POST } = await import("../api/checkout/eligible/route");
      return POST(post(`${SITE_ORIGIN}/api/checkout/eligible/`, { amount: 1, method: "snapppay" }), noParams);
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/payment/callback/[driver]", () => {
  /** Loads the route with `handleCallback` replaced, so a case can read exactly what it was given. */
  async function loadCallback(seen: { params?: Record<string, string>; driver?: string }): Promise<typeof CallbackRoute> {
    vi.doMock("@namilux/core", async (orig) => {
      const actual = await orig<typeof Core>();
      return {
        ...actual,
        getSettings: async () => actual.DEFAULT_SETTINGS,
        handleCallback: async (_db: unknown, driver: string, params: Record<string, string>) => {
          seen.driver = driver;
          seen.params = params;
          return { orderCode: "NL-7Q2F4", ok: true, test: true };
        },
      };
    });
    return import("../api/payment/callback/[driver]/route");
  }

  const formPost = (body: string, headers: Record<string, string> = {}): Request =>
    new Request(`${SITE_ORIGIN}/api/payment/callback/snapppay`, {
      method: "POST",
      body,
      // SnappPay posts from its own origin: a cross-site POST is exactly what this route must accept.
      headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "cross-site", ...headers },
    });

  afterEach(() => {
    vi.doUnmock("@namilux/core");
  });

  it("accepts SnappPay's cross-site form post and redirects with 303", async () => {
    const seen: { params?: Record<string, string>; driver?: string } = {};
    const res = await withEnv({ SITE_MODE: "main", SNAPPPAY_ENABLED: true, PAYMENT_DRIVER: "mock" }, async () => {
      const { POST } = await loadCallback(seen);
      return POST(formPost("transactionId=NL-7Q2F4-ABC&state=OK&amount=495000000"), { params: Promise.resolve({ driver: "snapppay" }) });
    });
    expect(seen.driver).toBe("snapppay");
    expect(seen.params).toMatchObject({ transactionId: "NL-7Q2F4-ABC", state: "OK", amount: "495000000" });
    // 303 turns the POST into a GET, so refreshing the result page does not re-post the callback.
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${SITE_ORIGIN}/billing/result/?o=NL-7Q2F4&s=ok`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("still takes ZarinPal's query-string return on GET", async () => {
    const seen: { params?: Record<string, string>; driver?: string } = {};
    const res = await withEnv({ SITE_MODE: "main", PAYMENT_DRIVER: "mock" }, async () => {
      const { GET } = await loadCallback(seen);
      return GET(new Request(`${SITE_ORIGIN}/api/payment/callback/zarinpal?Authority=A000X&Status=OK`), { params: Promise.resolve({ driver: "zarinpal" }) });
    });
    expect(seen.params).toEqual({ Authority: "A000X", Status: "OK" });
    expect(res.status).toBe(303);
  });

  it("an unknown driver is a 404 on both verbs, and never reaches handleCallback", async () => {
    const seen: { params?: Record<string, string>; driver?: string } = {};
    const [get, post_] = await withEnv({ SITE_MODE: "main", PAYMENT_DRIVER: "mock" }, async () => {
      const { GET, POST } = await loadCallback(seen);
      return Promise.all([
        GET(new Request(`${SITE_ORIGIN}/api/payment/callback/evil`), { params: Promise.resolve({ driver: "evil" }) }),
        POST(formPost("state=OK"), { params: Promise.resolve({ driver: "evil" }) }),
      ]);
    });
    expect(get.status).toBe(404);
    expect(post_.status).toBe(404);
    expect(seen.driver).toBeUndefined();
  });

  it("a body that is neither form nor JSON leaves only the query string to work with", async () => {
    const seen: { params?: Record<string, string>; driver?: string } = {};
    await withEnv({ SITE_MODE: "main", SNAPPPAY_ENABLED: true, PAYMENT_DRIVER: "mock" }, async () => {
      const { POST } = await loadCallback(seen);
      const req = new Request(`${SITE_ORIGIN}/api/payment/callback/snapppay?transactionId=NL-7Q2F4-ABC`, {
        method: "POST",
        body: "{not json",
        headers: { "content-type": "application/json" },
      });
      return POST(req, { params: Promise.resolve({ driver: "snapppay" }) });
    });
    // handleCallback still runs - with no `state`, which it reads as a failed callback.
    expect(seen.params).toEqual({ transactionId: "NL-7Q2F4-ABC" });
  });
});
