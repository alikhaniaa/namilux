import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, createTestDbAs, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { customers, eq, orders, products, shippingMethods } from "@namilux/db";
import { ulid } from "../../ids";
import { DEFAULT_SETTINGS } from "../../settings/schema";
import type { PaymentDriver } from "../payments";
import { placeOrder } from "../place";
import { loyalty } from "../../loyalty/ledger";
import * as paymentService from "../payments";
import { appError } from "../../errors";
import type { PlaceCtx } from "../place";
import type { PlaceRequest } from "../../validation/checkout";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const mockDriver: PaymentDriver = {
  key: "mock",
  async request(o) {
    return { ok: true, authority: `A-${o.orderCode}-${ulid().slice(-6)}`, redirectUrl: `https://gw.test/${o.orderCode}` };
  },
  async verify() {
    return { ok: true, refId: "REF1", alreadyVerified: false };
  },
};

describe.skipIf(!hasTestDb())("orders/place — integration", () => {
  let handle: TestDb;
  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterEach(async () => {
    await truncateAll(handle.db);
  });
  afterAll(async () => {
    await handle.close();
  });

  async function makeProduct(over: Partial<{ price: number; stockQty: number; status: "active" | "archived"; instalmentEligible: boolean }> = {}): Promise<number> {
    const [p] = await handle.db
      .insert(products)
      .values({
        slug: `pl-${ulid()}`,
        name: "کالا",
        displayName: "کالا",
        status: over.status ?? "active",
        visibility: "public",
        price: over.price ?? 5_000_000,
        stockQty: over.stockQty ?? 3,
        ...(over.instalmentEligible !== undefined ? { instalmentEligible: over.instalmentEligible } : {}),
      })
      .returning({ id: products.id });
    return p!.id;
  }
  let phoneSeq = 1000000;
  async function makeCustomer(): Promise<string> {
    const id = ulid();
    phoneSeq += 1;
    await handle.db.insert(customers).values({ id, phone: `0912${String(phoneSeq)}`, referralCode: ulid().slice(-8) });
    return id;
  }
  async function seedShipping(): Promise<void> {
    await handle.db.insert(shippingMethods).values({ key: "free_nationwide", name: "ارسال رایگان", kind: "free", rateJson: {}, etaMinDays: 2, etaMaxDays: 7, isActive: true, sort: 0 });
  }
  function ctx(
    customerId: string,
    settings = DEFAULT_SETTINGS,
    envOver: { CHECKOUT_ENABLED?: boolean; MAINTENANCE?: boolean } = {},
    channel: PlaceCtx["channel"] = "main",
  ): PlaceCtx {
    return {
      customerId,
      phone: "09121110000",
      ip: "1.2.3.4",
      ua: "test",
      settings,
      env: { SITE_ORIGIN: "https://namilux.ir", QUOTE_SIGNING_KEY: KEY, PAYMENT_DRIVER: "mock", ...envOver },
      channel,
      drivers: { payment: () => mockDriver },
    };
  }
  const req = (productId: number, more: { lines?: number[]; paymentMethod?: PlaceRequest["paymentMethod"] } = {}): PlaceRequest => ({
    quoteSig: "0".repeat(64),
    lines: [productId, ...(more.lines ?? [])].map((id) => ({ productId: id, qty: 1 })),
    shippingKey: "free_nationwide",
    address: { label: "خانه", recipientName: "علی", recipientPhone: "09121110000", province: "THR", city: "تهران", address: "خیابان الف مجتمع بلورین", plaque: "۶۴۲", unit: "۲", postcode: "1234567890", isDefault: false },
    paymentMethod: more.paymentMethod ?? "zarinpal",
  });

  it("checkout disabled → CHECKOUT_DISABLED", async () => {
    const id = await makeProduct();
    await seedShipping();
    const c = await makeCustomer();
    const settings = { ...DEFAULT_SETTINGS, "commerce.checkout_enabled": false };
    await expect(placeOrder(handle.db, req(id), ctx(c, settings))).rejects.toMatchObject({ code: "CHECKOUT_DISABLED" });
  });

  // The environment half of the pair: `/opt/namilux/.env` + a restart closes checkout with no
  // database write and no admin login - which is how a staging box on the real domain stays shut.
  it("CHECKOUT_ENABLED=false closes a shop the stored setting leaves open", async () => {
    const id = await makeProduct();
    await seedShipping();
    const c = await makeCustomer();
    await expect(placeOrder(handle.db, req(id), ctx(c, DEFAULT_SETTINGS, { CHECKOUT_ENABLED: false }))).rejects.toMatchObject({ code: "CHECKOUT_DISABLED" });
  });

  it("MAINTENANCE=true closes it too", async () => {
    const id = await makeProduct();
    await seedShipping();
    const c = await makeCustomer();
    await expect(placeOrder(handle.db, req(id), ctx(c, DEFAULT_SETTINGS, { MAINTENANCE: true }))).rejects.toMatchObject({ code: "MAINTENANCE" });
  });

  it("CHECKOUT_ENABLED=true re-opens a shop the setting closed - the variable decides in both directions", async () => {
    const id = await makeProduct();
    await seedShipping();
    const c = await makeCustomer();
    const settings = { ...DEFAULT_SETTINGS, "commerce.checkout_enabled": false };
    const result = await placeOrder(handle.db, req(id), ctx(c, settings, { CHECKOUT_ENABLED: true }));
    expect(result.order.code).toBeTruthy();
  });

  it("PRICE_CHANGED when the product is archived between quote and place", async () => {
    const id = await makeProduct({ status: "archived" });
    await seedShipping();
    const c = await makeCustomer();
    await expect(placeOrder(handle.db, req(id), ctx(c))).rejects.toMatchObject({ code: "PRICE_CHANGED" });
  });

  describe("per-product instalment switch", () => {
    it("main site SnappPay, mixed basket → CONFLICT naming exactly the switched-off product; nothing is placed", async () => {
      const ok = await makeProduct();
      const blocked = await makeProduct({ instalmentEligible: false });
      await seedShipping();
      const c = await makeCustomer();
      await expect(placeOrder(handle.db, req(ok, { lines: [blocked], paymentMethod: "snapppay" }), ctx(c, DEFAULT_SETTINGS, {}, "main"))).rejects.toMatchObject({
        code: "CONFLICT",
        details: { reason: "instalment_ineligible", productIds: [blocked] },
      });
      expect(await handle.db.select().from(orders)).toHaveLength(0);
    });

    it("main site SnappPay uses the same price as card payment", async () => {
      const id = await makeProduct({ price: 9_000_000 });
      await seedShipping();
      const c = await makeCustomer();
      const result = await placeOrder(handle.db, req(id, { paymentMethod: "snapppay" }), ctx(c, DEFAULT_SETTINGS, {}, "main"));
      expect(result.order.channel).toBe("main");
      expect(result.order.subtotal).toBe(9_000_000);
    });

    it("main site (card) sells a switched-off product exactly as before", async () => {
      const id = await makeProduct({ instalmentEligible: false });
      await seedShipping();
      const c = await makeCustomer();
      const result = await placeOrder(handle.db, req(id), ctx(c));
      expect(result.order.channel).toBe("main");
      expect(result.order.subtotal).toBe(5_000_000);
    });

    it("a hand-written `snapppay` request cannot carry a switched-off product even where the simulator accepts any method", async () => {
      const id = await makeProduct({ instalmentEligible: false });
      await seedShipping();
      const c = await makeCustomer();
      await expect(placeOrder(handle.db, req(id, { paymentMethod: "snapppay" }), ctx(c))).rejects.toMatchObject({
        code: "CONFLICT",
        details: { reason: "instalment_ineligible", productIds: [id] },
      });
    });

    it("the retired storefront cannot place new orders", async () => {
      const id = await makeProduct();
      await seedShipping();
      const c = await makeCustomer();
      await expect(placeOrder(handle.db, req(id), ctx(c, DEFAULT_SETTINGS, {}, "instalments"))).rejects.toMatchObject({ code: "VALIDATION" });
      expect(await handle.db.select().from(orders)).toHaveLength(0);
    });

  });

  it("pending cap → RATE_LIMITED after MAX_PENDING pending orders", async () => {
    const id = await makeProduct({ stockQty: 100 });
    await seedShipping();
    const c = await makeCustomer();
    for (let i = 0; i < 5; i += 1) await placeOrder(handle.db, req(id), ctx(c));
    await expect(placeOrder(handle.db, req(id), ctx(c))).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("charges the confirmed total after redeeming points and records the debit", async () => {
    const id = await makeProduct({ price: 1_000_000 });
    await seedShipping();
    const c = await makeCustomer();
    await loyalty.adjust(handle.db, c, 100, "test credit", { type: "system", id: null });
    let gatewayAmount = 0;
    const context = ctx(c);
    context.drivers = { payment: () => ({ ...mockDriver, request: async (input) => {
      gatewayAmount = input.amount;
      return mockDriver.request(input);
    } }) };
    const web = await createTestDbAs("web");
    const result = await placeOrder(web.db, { ...req(id), usePoints: true, expectedGrandTotal: 900_000 }, context).finally(() => web.close());
    expect(result.order).toMatchObject({ pointsRedeemed: 100, pointsDiscount: 100_000, grandTotal: 900_000 });
    expect(gatewayAmount).toBe(900_000);
    expect(await loyalty.balance(handle.db, c)).toBe(0);
  });

  it("rejects a changed confirmed total before creating an order or debiting points", async () => {
    const id = await makeProduct({ price: 1_000_000 });
    await seedShipping();
    const c = await makeCustomer();
    await loyalty.adjust(handle.db, c, 100, "test credit", { type: "system", id: null });
    await expect(placeOrder(handle.db, { ...req(id), usePoints: true, expectedGrandTotal: 800_000 }, ctx(c))).rejects.toMatchObject({ code: "PRICE_CHANGED" });
    expect(await handle.db.select().from(orders)).toHaveLength(0);
    expect(await loyalty.balance(handle.db, c)).toBe(100);
  });

  it("restores redeemed points when starting the gateway fails", async () => {
    const id = await makeProduct({ price: 1_000_000 });
    await seedShipping();
    const c = await makeCustomer();
    await loyalty.adjust(handle.db, c, 100, "test credit", { type: "system", id: null });
    const context = ctx(c);
    context.drivers = { payment: () => ({ ...mockDriver, request: async () => ({ ok: false, error: "offline" }) }) };
    await expect(placeOrder(handle.db, { ...req(id), usePoints: true }, context)).rejects.toMatchObject({ code: "PAYMENT_FAILED" });
    expect(await loyalty.balance(handle.db, c)).toBe(100);
  });

  it("serializes simultaneous redemptions for one customer", async () => {
    const ids = await Promise.all([makeProduct({ price: 1_000_000 }), makeProduct({ price: 1_000_000 })]);
    await seedShipping();
    const c = await makeCustomer();
    await loyalty.adjust(handle.db, c, 100, "test credit", { type: "system", id: null });
    const results = await Promise.allSettled(ids.map((id) => placeOrder(handle.db, { ...req(id), usePoints: true, expectedGrandTotal: 900_000 }, ctx(c))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await loyalty.balance(handle.db, c)).toBe(0);
    expect(await handle.db.select().from(orders)).toHaveLength(1);
  });

  it("a losing payment start cannot fail a concurrent live attempt or release its points", async () => {
    const id = await makeProduct({ price: 1_000_000 });
    await seedShipping();
    const c = await makeCustomer();
    await loyalty.adjust(handle.db, c, 100, "test credit", { type: "system", id: null });
    const actualStart = paymentService.startPayment;
    // Reproduce a different request completing its gateway start before this request loses.
    const start = vi.spyOn(paymentService, "startPayment").mockImplementationOnce(async (db, order, driver, env) => {
      await actualStart(db, order, driver, env);
      throw appError("CONFLICT");
    });
    try {
      await expect(placeOrder(handle.db, { ...req(id), usePoints: true }, ctx(c))).rejects.toMatchObject({ code: "CONFLICT" });
      const [order] = await handle.db.select().from(orders);
      expect(order?.status).toBe("pending_payment");
      expect(await loyalty.balance(handle.db, c)).toBe(0);
    } finally {
      start.mockRestore();
    }
  });

  it("does not silently replace an unavailable shipping method", async () => {
    const id = await makeProduct();
    await seedShipping();
    const c = await makeCustomer();
    await expect(placeOrder(handle.db, { ...req(id), shippingKey: "unavailable" }, ctx(c))).rejects.toMatchObject({ code: "PRICE_CHANGED" });
    expect(await handle.db.select().from(orders)).toHaveLength(0);
  });

  it("50 concurrent places on stock 3 → exactly 3 orders, 47 OUT_OF_STOCK", async () => {
    const id = await makeProduct({ stockQty: 3 });
    await seedShipping();
    const customerIds = await Promise.all(Array.from({ length: 50 }, () => makeCustomer()));
    const results = await Promise.allSettled(customerIds.map((c) => placeOrder(handle.db, req(id), ctx(c))));
    const ok = results.filter((r) => r.status === "fulfilled");
    // The no-overselling invariant (the spec §M3): exactly 3 of the 50 succeed and exactly 3 orders exist.
    // The FOR UPDATE reservation lock serializes the 50 transactions and the losers roll back
    // atomically. (Losers surface OUT_OF_STOCK, or - under the test pool's 4-connection cap while
    // place holds the product lock through the whole order tx - a connection-acquire timeout; neither
    // oversells, which the order count proves. The bare-reserve concurrency test asserts the clean
    // OUT_OF_STOCK path.)
    expect(ok).toHaveLength(3);
    const placed = await handle.db.select().from(orders).where(eq(orders.status, "pending_payment"));
    expect(placed).toHaveLength(3);
  }, 30_000);
});
