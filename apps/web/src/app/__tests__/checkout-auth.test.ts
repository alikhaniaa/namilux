import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Core from "@namilux/core";
import type * as Session from "@/lib/session";

/**
 * Who may open a payment: placing an order, and retrying one.
 *
 * The fresh-OTP gate (`auth: "session-verified"`, a code within lib/session.ts REVERIFY_MS) used to
 * stand in front of BOTH storefronts' place route. A shopper who had signed in half an hour earlier
 * and then filled a basket was told «برای این کار باید دوباره با پیامک تأیید کنید» at the pay
 * button and could not buy. On the card site the gate is gone; everything else that guards the
 * route - the session itself, the same-origin check, the per-customer and per-IP limits, and
 * ownership on the retry - is what these cases hold in place. The instalment site keeps the gate:
 * SnappPay opens a credit line in the shopper's name.
 *
 * Both routes read `@/env` at module load, so each case loads them again behind a mocked env (the
 * shape `checkout-flags.test.ts` and `payment-channel.test.ts` use). `isRecentlyVerified` is the
 * REAL one - it is the rule under test - and only `currentUser` is replaced.
 */
const MAIN_ORIGIN = "https://namilux.ir";
const INSTALMENTS_ORIGIN = "https://namilux.ir";
const CUSTOMER_ID = "0000000000000000000CUST001";
const NOW = new Date("2026-09-20T12:00:00.000Z");

const BASE_ENV = {
  APP_ENV: "staging",
  TRUST_PROXY: false,
  INTERNAL_SIGNING_KEY: "k".repeat(64),
  QUOTE_SIGNING_KEY: "q".repeat(64),
  PAYMENT_DRIVER: "mock",
  SMS_DRIVER: "mock",
};

const MAIN_ENV = { ...BASE_ENV, SITE_ORIGIN: MAIN_ORIGIN, SITE_MODE: "main" };
const INSTALMENTS_ENV = { ...BASE_ENV, SITE_ORIGIN: INSTALMENTS_ORIGIN, SITE_MODE: "main", SNAPPPAY_ENABLED: true };

/** A signed-in shopper whose last SMS code is `minutesAgo` old; null = no session at all. */
function shopper(minutesAgo: number | null): Core.SessionUser {
  return {
    customerId: CUSTOMER_ID,
    phone: "09121234567",
    phoneVerifiedAt: "2026-01-01T00:00:00.000Z",
    firstName: "علی",
    lastName: "کریمی",
    email: null,
    tier: "member",
    pointsBalance: 0,
    isBlocked: false,
    sessionId: "0000000000000000000SESS001",
    lastOtpAt: minutesAgo === null ? null : new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
  };
}

type Seen = { placed: number; retried: number; orderOwner: string; orderChannel?: "main" | "instalments" };

async function withRoutes<T>(
  env: Record<string, unknown>,
  user: Core.SessionUser | null,
  seen: Seen,
  fn: () => Promise<T>,
): Promise<T> {
  vi.resetModules();
  vi.doMock("@/env", () => ({ env }));
  vi.doMock("@/lib/db", () => ({
    db: {
      select: () => {
        throw new Error("this route must not touch the database");
      },
    },
  }));
  vi.doMock("@/lib/session", async (orig) => {
    const actual = await orig<typeof Session>();
    return { ...actual, currentUser: async () => user };
  });
  vi.doMock("@namilux/core", async (orig) => {
    const actual = await orig<typeof Core>();
    return {
      ...actual,
      getSettings: async () => actual.DEFAULT_SETTINGS,
      ordersRepo: {
        ...actual.ordersRepo,
        findByCode: async () => ({ id: "0000000000000000000ORDER01", customerId: seen.orderOwner, code: "NL-7Q2F4", status: "pending_payment", channel: seen.orderChannel ?? "main" }),
      },
      placeOrder: async () => {
        seen.placed += 1;
        return { order: { code: "NL-7Q2F4" }, payment: { redirectUrl: "https://gw.test/x" } };
      },
      retryPayment: async () => {
        seen.retried += 1;
        return { redirectUrl: "https://gw.test/x" };
      },
    };
  });
  try {
    return await fn();
  } finally {
    vi.doUnmock("@/env");
    vi.doUnmock("@/lib/db");
    vi.doUnmock("@/lib/session");
    vi.doUnmock("@namilux/core");
    vi.resetModules();
  }
}

const placeBody = {
  quoteSig: "0".repeat(64),
  lines: [{ productId: 1, qty: 1 }],
  shippingKey: "free_nationwide",
  addressId: "0000000000000000000ADDR001",
  paymentMethod: "zarinpal",
};

const post = (origin: string, path: string, body?: unknown, headers: Record<string, string> = {}): Request =>
  new Request(`${origin}${path}`, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { "content-type": "application/json", origin, "sec-fetch-site": "same-origin", ...headers },
  });

const noParams = { params: Promise.resolve({}) };
const retryParams = { params: Promise.resolve({ code: "NL-7Q2F4" }) };

type Envelope = { ok: boolean; error?: { code: string; message: string } };
const fresh = (): Seen => ({ placed: 0, retried: 0, orderOwner: CUSTOMER_ID });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/checkout/place - the card site", () => {
  it("an hours-old OTP no longer stops a signed-in shopper from paying", async () => {
    const seen = fresh();
    const res = await withRoutes(MAIN_ENV, shopper(240), seen, async () => {
      const { POST } = await import("../api/checkout/place/route");
      return POST(post(MAIN_ORIGIN, "/api/checkout/place/", placeBody), noParams);
    });
    expect(res.status).toBe(200);
    expect(seen.placed).toBe(1);
  });

  it("a session that never verified by SMS at all is still a session, and may pay", async () => {
    const seen = fresh();
    const res = await withRoutes(MAIN_ENV, shopper(null), seen, async () => {
      const { POST } = await import("../api/checkout/place/route");
      return POST(post(MAIN_ORIGIN, "/api/checkout/place/", placeBody), noParams);
    });
    expect(res.status).toBe(200);
    expect(seen.placed).toBe(1);
  });

  it("no session is still a 401, and placeOrder is never reached", async () => {
    const seen = fresh();
    const res = await withRoutes(MAIN_ENV, null, seen, async () => {
      const { POST } = await import("../api/checkout/place/route");
      return POST(post(MAIN_ORIGIN, "/api/checkout/place/", placeBody), noParams);
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Envelope;
    expect(body.error?.code).toBe("UNAUTHORIZED");
    // The shopper reads a Persian sentence telling them to sign in, never the code.
    expect(body.error?.message).toMatch(/[؀-ۿ]/);
    expect(seen.placed).toBe(0);
  });

  it("the same-origin gate is untouched: a cross-site POST with a valid session is still 403", async () => {
    const seen = fresh();
    const res = await withRoutes(MAIN_ENV, shopper(1), seen, async () => {
      const { POST } = await import("../api/checkout/place/route");
      return POST(post(MAIN_ORIGIN, "/api/checkout/place/", placeBody, { "sec-fetch-site": "cross-site", origin: "https://evil.example" }), noParams);
    });
    expect(res.status).toBe(403);
    expect(seen.placed).toBe(0);
  });

  it("the body is still strict and still bounded", async () => {
    const seen = fresh();
    const [extra, huge] = await withRoutes(MAIN_ENV, shopper(1), seen, async () => {
      const { POST } = await import("../api/checkout/place/route");
      return Promise.all([
        POST(post(MAIN_ORIGIN, "/api/checkout/place/", { ...placeBody, isAdmin: true }), noParams),
        POST(post(MAIN_ORIGIN, "/api/checkout/place/", { ...placeBody, note: "ن".repeat(9000) }), noParams),
      ]);
    });
    expect(extra?.status).toBe(400);
    expect(huge?.status).toBe(413);
    expect(seen.placed).toBe(0);
  });
});

describe("POST /api/checkout/place - SnappPay on the main site uses the authenticated session", () => {
  it("an authenticated shopper can choose SnappPay after filling a basket", async () => {
    const seen = fresh();
    const res = await withRoutes(INSTALMENTS_ENV, shopper(240), seen, async () => {
      const { POST } = await import("../api/checkout/place/route");
      return POST(post(INSTALMENTS_ORIGIN, "/api/checkout/place/", { ...placeBody, paymentMethod: "snapppay" }), noParams);
    });
    expect(res.status).toBe(200);
    expect(seen.placed).toBe(1);
  });

  it("a code from a minute ago goes through", async () => {
    const seen = fresh();
    const res = await withRoutes(INSTALMENTS_ENV, shopper(1), seen, async () => {
      const { POST } = await import("../api/checkout/place/route");
      return POST(post(INSTALMENTS_ORIGIN, "/api/checkout/place/", { ...placeBody, paymentMethod: "snapppay" }), noParams);
    });
    expect(res.status).toBe(200);
    expect(seen.placed).toBe(1);
  });
});

describe("POST /api/me/orders/[code]/retry", () => {
  it("the owner may retry a historical instalment order on the unified storefront", async () => {
    const seen: Seen = { ...fresh(), orderChannel: "instalments" };
    const res = await withRoutes(MAIN_ENV, shopper(600), seen, async () => {
      const { POST } = await import("../api/me/orders/[code]/retry/route");
      return POST(post(MAIN_ORIGIN, "/api/me/orders/NL-7Q2F4/retry/"), retryParams);
    });
    expect(res.status).toBe(200);
    expect(seen.retried).toBe(1);
  });

  it("an old session may re-open the gateway for an order it already owns", async () => {
    const seen = fresh();
    const res = await withRoutes(MAIN_ENV, shopper(600), seen, async () => {
      const { POST } = await import("../api/me/orders/[code]/retry/route");
      return POST(post(MAIN_ORIGIN, "/api/me/orders/NL-7Q2F4/retry/"), retryParams);
    });
    expect(res.status).toBe(200);
    expect(seen.retried).toBe(1);
  });

  it("someone else's order reads exactly like one that does not exist", async () => {
    const seen = { ...fresh(), orderOwner: "0000000000000000000CUST999" };
    const res = await withRoutes(MAIN_ENV, shopper(1), seen, async () => {
      const { POST } = await import("../api/me/orders/[code]/retry/route");
      return POST(post(MAIN_ORIGIN, "/api/me/orders/NL-7Q2F4/retry/"), retryParams);
    });
    expect(res.status).toBe(404);
    expect(seen.retried).toBe(0);
  });

  it("without a session there is nothing to retry", async () => {
    const seen = fresh();
    const res = await withRoutes(MAIN_ENV, null, seen, async () => {
      const { POST } = await import("../api/me/orders/[code]/retry/route");
      return POST(post(MAIN_ORIGIN, "/api/me/orders/NL-7Q2F4/retry/"), retryParams);
    });
    expect(res.status).toBe(401);
    expect(seen.retried).toBe(0);
  });

  it("and a cross-site retry is refused even with a valid session", async () => {
    const seen = fresh();
    const res = await withRoutes(MAIN_ENV, shopper(1), seen, async () => {
      const { POST } = await import("../api/me/orders/[code]/retry/route");
      return POST(post(MAIN_ORIGIN, "/api/me/orders/NL-7Q2F4/retry/", undefined, { "sec-fetch-site": "cross-site" }), retryParams);
    });
    expect(res.status).toBe(403);
    expect(seen.retried).toBe(0);
  });
});
