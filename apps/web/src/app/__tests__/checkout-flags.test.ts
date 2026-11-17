import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Core from "@namilux/core";

/**
 * The two routes that re-open payment - placing an order and retrying a pending one - against the
 * CHECKOUT_ENABLED / MAINTENANCE environment overrides.
 *
 * Both read `@/env` at module load, so each case loads them again behind a mocked env (the shape
 * `payment-channel.test.ts` uses). `@namilux/core` is loaded for real and only the two functions
 * that would reach the database are replaced, so the routes' own wiring is what is under test;
 * `@/lib/db` throws to prove nothing else touches it.
 */
const SITE_ORIGIN = "https://namilux.ir";
const ORDER_ID = "0000000000000000000ORDER01";
const CUSTOMER_ID = "0000000000000000000CUST001";

const BASE_ENV = {
  SITE_ORIGIN,
  APP_ENV: "staging",
  SITE_MODE: "main",
  TRUST_PROXY: false,
  INTERNAL_SIGNING_KEY: "k".repeat(64),
  QUOTE_SIGNING_KEY: "q".repeat(64),
  PAYMENT_DRIVER: "mock",
  SMS_DRIVER: "mock",
};

type Envelope = { ok: boolean; error?: { code: string; message: string } };
type Seen = { place?: Core.PlaceCtx; retried: number };

/** Loads a route module with the env, the session and the two DB-touching core calls replaced. */
async function withRoute<T>(
  over: Record<string, unknown>,
  seen: Seen,
  fn: () => Promise<T>,
): Promise<T> {
  vi.resetModules();
  vi.doMock("@/env", () => ({ env: { ...BASE_ENV, ...over } }));
  vi.doMock("@/lib/db", () => ({
    db: {
      select: () => {
        throw new Error("this route must not touch the database");
      },
    },
  }));
  vi.doMock("@/lib/session", () => ({
    currentUser: async () => ({ customerId: CUSTOMER_ID, phone: "09121234567", firstName: "علی", lastName: "کریمی", pointsBalance: 0 }),
    isRecentlyVerified: () => true,
  }));
  vi.doMock("@namilux/core", async (orig) => {
    const actual = await orig<typeof Core>();
    return {
      ...actual,
      getSettings: async () => actual.DEFAULT_SETTINGS,
      ordersRepo: { ...actual.ordersRepo, findByCode: async () => ({ id: ORDER_ID, customerId: CUSTOMER_ID, code: "NL-7Q2F4", status: "pending_payment", channel: "main" }) },
      placeOrder: async (_db: unknown, _req: unknown, ctx: Core.PlaceCtx) => {
        seen.place = ctx;
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

const post = (url: string, body?: unknown): Request =>
  new Request(url, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { "content-type": "application/json", origin: SITE_ORIGIN, "sec-fetch-site": "same-origin" },
  });

const placeBody = {
  quoteSig: "0".repeat(64),
  lines: [{ productId: 1, qty: 1 }],
  shippingKey: "free_nationwide",
  address: { label: "خانه", recipientName: "علی", recipientPhone: "09121110000", province: "THR", city: "تهران", address: "خیابان الف مجتمع بلورین", plaque: "۶۴۲", unit: "۲", postcode: "1234567890", isDefault: false },
  paymentMethod: "zarinpal",
};

const retryParams = { params: Promise.resolve({ code: "NL-7Q2F4" }) };
const noParams = { params: Promise.resolve({}) };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/checkout/place - the environment overrides reach placeOrder", () => {
  it("CHECKOUT_ENABLED / MAINTENANCE travel in ctx.env, where effectiveFlags reads them", async () => {
    const seen: Seen = { retried: 0 };
    const res = await withRoute({ CHECKOUT_ENABLED: false, MAINTENANCE: true }, seen, async () => {
      const { POST } = await import("../api/checkout/place/route");
      return POST(post(`${SITE_ORIGIN}/api/checkout/place/`, placeBody), noParams);
    });
    expect(res.status).toBe(200);
    expect(seen.place?.env).toMatchObject({ CHECKOUT_ENABLED: false, MAINTENANCE: true });
  });

  it("with neither variable set the stored setting alone decides", async () => {
    const seen: Seen = { retried: 0 };
    await withRoute({}, seen, async () => {
      const { POST } = await import("../api/checkout/place/route");
      return POST(post(`${SITE_ORIGIN}/api/checkout/place/`, placeBody), noParams);
    });
    expect(seen.place?.env.CHECKOUT_ENABLED).toBeUndefined();
    expect(seen.place?.env.MAINTENANCE).toBeUndefined();
  });
});

describe("POST /api/me/orders/[code]/retry - a closed shop refuses to re-open payment", () => {
  it("CHECKOUT_ENABLED=0 → 503 CHECKOUT_DISABLED, and the gateway is never called", async () => {
    const seen: Seen = { retried: 0 };
    const res = await withRoute({ CHECKOUT_ENABLED: false }, seen, async () => {
      const { POST } = await import("../api/me/orders/[code]/retry/route");
      return POST(post(`${SITE_ORIGIN}/api/me/orders/NL-7Q2F4/retry/`), retryParams);
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as Envelope;
    expect(body.error?.code).toBe("CHECKOUT_DISABLED");
    // The shopper reads a Persian sentence, never the code.
    expect(body.error?.message).toMatch(/[؀-ۿ]/);
    expect(seen.retried).toBe(0);
  });

  it("MAINTENANCE=1 → 503 MAINTENANCE", async () => {
    const seen: Seen = { retried: 0 };
    const res = await withRoute({ MAINTENANCE: true }, seen, async () => {
      const { POST } = await import("../api/me/orders/[code]/retry/route");
      return POST(post(`${SITE_ORIGIN}/api/me/orders/NL-7Q2F4/retry/`), retryParams);
    });
    expect(res.status).toBe(503);
    expect(((await res.json()) as Envelope).error?.code).toBe("MAINTENANCE");
    expect(seen.retried).toBe(0);
  });

  it("with the shop open the retry still goes through", async () => {
    const seen: Seen = { retried: 0 };
    const res = await withRoute({}, seen, async () => {
      const { POST } = await import("../api/me/orders/[code]/retry/route");
      return POST(post(`${SITE_ORIGIN}/api/me/orders/NL-7Q2F4/retry/`), retryParams);
    });
    expect(res.status).toBe(200);
    expect(seen.retried).toBe(1);
  });
});
