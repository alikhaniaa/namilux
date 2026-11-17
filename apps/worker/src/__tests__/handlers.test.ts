import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { and, customers, eq, inventoryReservations, jobs as jobsTable, orderEvents, orders, payments, products, questions, shippingMethods, smsLog } from "@namilux/db";
import type { Db } from "@namilux/db";
import { DEFAULT_SETTINGS, jobs, ordersRepo, orderState, ulid } from "@namilux/core";
import type { PaymentDriver } from "@namilux/core";
import { placeOrder } from "@namilux/core";
import type { Job } from "@namilux/core";
import { cacheRevalidate } from "../handlers/cache-revalidate";
import { paymentSettle } from "../handlers/payment-settle";
import { jobsPrune } from "../handlers/jobs-prune";
import { reservationExpire } from "../handlers/reservation-expire";
import { orderExpire } from "../handlers/order-expire";
import { smsSend } from "../handlers/sms-send";
import type { Drivers, HandlerCtx, Logger } from "../runtime";
import type { WorkerEnv } from "../env";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const mockDriver: PaymentDriver = {
  key: "mock",
  async request(o) {
    return { ok: true, authority: `A-${o.orderCode}-${ulid().slice(-6)}`, redirectUrl: `https://gw.test/${o.orderCode}` };
  },
  async verify() {
    return { ok: true, refId: "REF1", alreadyVerified: false };
  },
};

function fakeJob(payload: Record<string, unknown>): Job {
  return {
    id: ulid(),
    type: "sms.send",
    payload,
    status: "running",
    runAt: new Date().toISOString(),
    attempts: 0,
    maxAttempts: 5,
    lastError: null,
    lockedBy: "test",
    lockedAt: new Date().toISOString(),
    uniqueKey: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };
}

describe.skipIf(!hasTestDb())("worker handlers — integration", () => {
  let tdb: TestDb;
  let db: Db;

  beforeAll(async () => {
    tdb = await createTestDb();
    db = tdb.db;
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await truncateAll(tdb.db);
  });
  afterAll(async () => {
    await tdb.close();
  });

  let phoneSeq = 0;

  function ctx(over: { job: Job; drivers?: Partial<Drivers>; env?: Partial<WorkerEnv> }): HandlerCtx {
    return {
      db,
      drivers: (over.drivers ?? {}) as unknown as Drivers,
      env: {
        SITE_ORIGIN: "https://namilux.ir",
        WEB_INTERNAL_URL: "http://127.0.0.1:3000",
        INTERNAL_SIGNING_KEY: KEY,
        SMS_DAILY_BUDGET_TOMAN: 2_000_000,
        ...(over.env ?? {}),
      } as unknown as WorkerEnv,
      log: silent,
      job: over.job,
      signal: new AbortController().signal,
    };
  }

  // -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - sms-send

  it("sms-send writes a MASKED phone to sms_log", async () => {
    const sms = { key: "mock" as const, send: vi.fn(async () => ({ ok: true as const, providerRef: "r1", segments: 1, costToman: 100 })) };
    await smsSend(ctx({ job: fakeJob({ template: "product.back_in_stock", phone: "09121234567", vars: { name: "کتری" } }), drivers: { sms } }));

    const rows = await db.select().from(smsLog).limit(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.toMasked).toBe("0912***4567");
    expect(rows[0]?.toMasked).not.toMatch(/^09\d{9}$/); // the DB CHECK also guarantees this
    expect(rows[0]?.status).toBe("sent");
    expect(sms.send).toHaveBeenCalledTimes(1);
  });

  it("sms-send does not resend an order SMS already marked sent (idempotent)", async () => {
    const orderId = ulid();
    await db.insert(smsLog).values({ id: ulid(), toMasked: "0912***4567", toHash: "h", template: "order.paid", provider: "mock", status: "sent", orderId });
    const sms = { key: "mock" as const, send: vi.fn(async () => ({ ok: true as const, providerRef: "r", segments: 1, costToman: 100 })) };

    await smsSend(ctx({ job: fakeJob({ template: "order.paid", phone: "09121234567", orderId }), drivers: { sms } }));

    expect(sms.send).not.toHaveBeenCalled();
    const rows = await db.select().from(smsLog).where(eq(smsLog.orderId, orderId));
    expect(rows).toHaveLength(1); // no second row
  });

  it("sms-send stops at the daily budget without sending", async () => {
    // Pre-spend the whole budget today.
    await db.insert(smsLog).values({ id: ulid(), toMasked: "0912***0000", toHash: "h", template: "order.paid", provider: "mock", status: "sent", cost: 500 });
    const sms = { key: "mock" as const, send: vi.fn(async () => ({ ok: true as const, providerRef: "r", segments: 1, costToman: 100 })) };

    await smsSend(ctx({ job: fakeJob({ template: "product.back_in_stock", phone: "09121234567", vars: { name: "x" } }), drivers: { sms }, env: { SMS_DAILY_BUDGET_TOMAN: 400 } }));

    expect(sms.send).not.toHaveBeenCalled();
    const dropped = await db.select().from(smsLog).where(and(eq(smsLog.template, "product.back_in_stock"), eq(smsLog.status, "failed")));
    expect(dropped[0]?.error).toBe("budget");
  });

  // -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - sms-send after the pattern rebuild

  /** A pending order on one of the two storefronts. */
  const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // ORDER_CODE_RE: Crockford-ish, no I/L/O/0/1
  async function pendingOrderOn(channel: "main" | "instalments"): Promise<{ id: string; code: string }> {
    const id = ulid();
    const code = `NL-${Array.from(ulid().slice(-10)).map((c) => CODE_ALPHABET[c.charCodeAt(0) % CODE_ALPHABET.length] ?? "2").join("").slice(0, 5)}`;
    const customerId = ulid();
    await db.insert(customers).values({ id: customerId, phone: `0912${String(2_000_000 + phoneSeq++).slice(-7)}`, referralCode: ulid().slice(-8) });
    await db.insert(orders).values({ id, code, phone: "09121110000", customerId, status: "pending_payment", channel, subtotal: 5_000_000, grandTotal: 5_000_000, placedAt: new Date() });
    return { id, code };
  }

  it("an order SMS carries the code and a fixed address - never a per-order link", async () => {
    // FarazSMS refused every pattern that took a URL as a variable, so the rebuilt wording points at
    // namilux.ir/account (whose orders list carries the retry-payment action) and prints no link.
    const sms = { key: "mock" as const, send: vi.fn(async (_phone: string, _text: string) => ({ ok: true as const, providerRef: "r", segments: 1, costToman: 100 })) };
    const order = await pendingOrderOn("main");
    await smsSend(ctx({ job: fakeJob({ template: "order.placed_pending", phone: "09121234567", orderId: order.id }), drivers: { sms } }));

    const [, text, opts] = sms.send.mock.calls[0] as unknown as [string, string, { vars: Record<string, unknown> }];
    expect(text).toContain(order.code);
    expect(text).toContain("namilux.ir/account");
    expect(text).not.toContain("/pay/");
    // `url` is gone, and so is the name `code`: BMLSGWOKp6 declares the order code as `sefaresh`,
    // because a variable called `code` is rewritten to a 6-digit int by their reviewer.
    expect(opts.vars).toEqual({ sefaresh: order.code });
  });

  it("a historical order now links to the main site and uses its pattern", async () => {
    // 15 Sep 2026: the instalment site never sends its shoppers to namilux.ir. The address is {site},
    // filled from the order's channel, and the pattern is `<template>`. With no such code
    // registered the driver sends the rendered text as free text, never the main site's pattern.
    const sms = { key: "mock" as const, send: vi.fn(async (_phone: string, _text: string) => ({ ok: true as const, providerRef: "r", segments: 1, costToman: 100 })) };
    const env = { SITE_ORIGIN: "https://namilux.ir" };
    const order = await pendingOrderOn("instalments");
    await smsSend(ctx({ job: fakeJob({ template: "order.expired", phone: "09121234569", orderId: order.id }), drivers: { sms }, env }));

    const [, text, opts] = sms.send.mock.calls[0] as unknown as [string, string, { vars: Record<string, unknown>; patternKey?: string }];
    expect(text).toContain(order.code);
    expect(text).toContain("namilux.ir/account");
    expect(text).not.toContain("/pay/");
    expect(opts.vars).toEqual({ sefaresh: order.code }); // {site} is never a pattern attribute
    expect(opts.patternKey).toBeUndefined();
  });

  it("historical orders use the main site without a second-site configuration", async () => {
    const sms = { key: "mock" as const, send: vi.fn(async (_phone: string, _text: string) => ({ ok: true as const, providerRef: "r", segments: 1, costToman: 100 })) };
    const order = await pendingOrderOn("instalments");
    await smsSend(ctx({ job: fakeJob({ template: "order.placed_pending", phone: "09121234573", orderId: order.id }), drivers: { sms } }));
    expect(sms.send).toHaveBeenCalledOnce();
  });

  it("a message that prints no address uses the main pattern on both sites", async () => {
    const sms = { key: "mock" as const, send: vi.fn(async (_phone: string, _text: string) => ({ ok: true as const, providerRef: "r", segments: 1, costToman: 100 })) };
    const order = await pendingOrderOn("instalments");
    await smsSend(ctx({ job: fakeJob({ template: "order.delivered", phone: "09121234574", orderId: order.id }), drivers: { sms }, env: { SITE_ORIGIN: "https://namilux.ir" } }));
    const [, , opts] = sms.send.mock.calls[0] as unknown as [string, string, { vars: Record<string, unknown>; patternKey?: string }];
    expect(opts.vars).toEqual({ code: order.code });
    expect(opts.patternKey).toBeUndefined();
  });

  it("a reply to a historical price request links to the main site", async () => {
    const sms = { key: "mock" as const, send: vi.fn(async (_phone: string, _text: string) => ({ ok: true as const, providerRef: "r", segments: 1, costToman: 100 })) };
    const [product] = await db.insert(products).values({ slug: `q-${ulid()}`, name: "کتری", displayName: "کتری برقی", status: "active", visibility: "public", price: 0, stockQty: 0 }).returning({ id: products.id });
    const questionId = ulid();
    await db.insert(questions).values({ id: questionId, kind: "price", productId: product!.id, phone: "09121234576", body: "", answer: "پاسخ", status: "answered", channel: "instalments" });
    await smsSend(ctx({ job: fakeJob({ template: "concierge.reply", phone: "09121234576", questionId }), drivers: { sms }, env: { SITE_ORIGIN: "https://namilux.ir" } }));
    const [, text, opts] = sms.send.mock.calls[0] as unknown as [string, string, { vars: Record<string, unknown>; patternKey?: string }];
    expect(text).toContain("namilux.ir/account");
    expect(opts.vars).toEqual({ name: "کتری" });
    expect(opts.patternKey).toBeUndefined();
  });

  it("order.cancelled no longer sends the free-form note FarazSMS refused", async () => {
    const sms = { key: "mock" as const, send: vi.fn(async (_phone: string, _text: string) => ({ ok: true as const, providerRef: "r", segments: 1, costToman: 100 })) };
    const order = await pendingOrderOn("main");
    await smsSend(ctx({ job: fakeJob({ template: "order.cancelled", phone: "09121234570", orderId: order.id }), drivers: { sms } }));
    const [, , opts] = sms.send.mock.calls[0] as unknown as [string, string, { vars: Record<string, unknown> }];
    expect(opts.vars).toEqual({ sefaresh: order.code }); // wEScZeJepK
  });

  it("order.delivered keeps the variable named `code` - that pattern was approved before the rename", async () => {
    // The four order patterns approved on 7 Sep declare `code` at str 10 and still fit an NL-XXXXX
    // code, so they are left alone. Only the three the reviewer narrowed to int(6) were rebuilt, and
    // a mismatch either way is not an error - it is a silent detour into the moderation queue.
    const sms = { key: "mock" as const, send: vi.fn(async (_phone: string, _text: string) => ({ ok: true as const, providerRef: "r", segments: 1, costToman: 100 })) };
    const order = await pendingOrderOn("main");
    await smsSend(ctx({ job: fakeJob({ template: "order.delivered", phone: "09121234572", orderId: order.id }), drivers: { sms } }));
    const [, , opts] = sms.send.mock.calls[0] as unknown as [string, string, { vars: Record<string, unknown> }];
    expect(opts.vars).toEqual({ code: order.code });
  });

  it("customer.welcome sends with an EMPTY variable map, not with none", async () => {
    // 95DOACyydm declares no variables. Returning null here would log "no vars to render; skipping"
    // and drop the message; returning {} is what keeps it on the instant pattern route.
    const sms = { key: "mock" as const, send: vi.fn(async (_phone: string, _text: string) => ({ ok: true as const, providerRef: "r", segments: 1, costToman: 100 })) };
    await smsSend(ctx({ job: fakeJob({ template: "customer.welcome", phone: "09121234571" }), drivers: { sms } }));

    expect(sms.send).toHaveBeenCalledTimes(1);
    const [, text, opts] = sms.send.mock.calls[0] as unknown as [string, string, { vars: Record<string, unknown> }];
    expect(opts.vars).toEqual({});
    expect(text).toContain("namilux.ir/account");
  });

  it("a welcome for a historical signup links to the main site", async () => {
    const sms = { key: "mock" as const, send: vi.fn(async (_phone: string, _text: string) => ({ ok: true as const, providerRef: "r", segments: 1, costToman: 100 })) };
    await smsSend(ctx({ job: fakeJob({ template: "customer.welcome", phone: "09121234575", channel: "instalments" }), drivers: { sms }, env: { SITE_ORIGIN: "https://namilux.ir" } }));
    const [, text, opts] = sms.send.mock.calls[0] as unknown as [string, string, { vars: Record<string, unknown>; patternKey?: string }];
    expect(text).toContain("namilux.ir/account");
    expect(opts.vars).toEqual({});
    expect(opts.patternKey).toBeUndefined();
  });

  // -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - payment.settle

  /**
   * A two-phase gateway (SnappPay): verify only HOLDS the credit, and the hold lapses unless settle
   * runs. The callback settles inline; this job is the retry for when that call did not go through.
   */
  function twoPhaseDriver(over: Partial<PaymentDriver> = {}): { payment: { payment: () => PaymentDriver } } {
    const driver: PaymentDriver = {
      key: "snapppay",
      parseCallback: (p) => ({ authority: p["transactionId"] ?? "", ok: p["state"] === "OK" }),
      async request() { return { ok: false, error: "n/a" }; },
      async verify() { return { ok: true, refId: "PT-1", alreadyVerified: false, needsSettle: true }; },
      async settle() { return { ok: true }; },
      ...over,
    };
    return { payment: { payment: () => driver } };
  }

  async function paidHeldOrder(): Promise<{ orderId: string; paymentId: string; authority: string }> {
    const { id } = await pendingOrderOn("instalments");
    const authority = `TX-${ulid().slice(-8)}`;
    const payment = await ordersRepo.payments.insert(db, {
      orderId: id,
      driver: "snapppay",
      amount: 5_000_000,
      status: "redirected",
      authority,
      refId: "PT-1",
      cardPanMasked: null,
      fee: null,
    });
    return { orderId: id, paymentId: payment.id, authority };
  }

  it("payment-settle commits a held payment and records it on the timeline", async () => {
    const { orderId, paymentId, authority } = await paidHeldOrder();
    const settle = vi.fn(async () => ({ ok: true }));
    await paymentSettle(ctx({ job: { ...fakeJob({ orderId, paymentId, driver: "snapppay" }), type: "payment.settle" }, drivers: twoPhaseDriver({ settle }) as unknown as Partial<Drivers> }));
    // Keyed on the paymentToken stored in ref_id, with our own transactionId alongside it.
    expect(settle).toHaveBeenCalledWith({ authority, providerRef: "PT-1" });
    const events = await db.select({ type: orderEvents.type }).from(orderEvents).where(eq(orderEvents.orderId, orderId));
    expect(events.map((e) => e.type)).toContain("payment.settled");
  });

  it("payment-settle keeps an uncertain payment pending and asks the queue to retry", async () => {
    const { orderId, paymentId } = await paidHeldOrder();
    const stuck = twoPhaseDriver({ settle: async () => ({ ok: false, error: "transport" }) });
    await expect(paymentSettle(ctx({ job: { ...fakeJob({ orderId, paymentId, driver: "snapppay" }), type: "payment.settle" }, drivers: stuck as unknown as Partial<Drivers> }))).rejects.toThrow(/unresolved/);
    expect((await ordersRepo.findById(db, orderId))?.status).toBe("pending_payment");
    expect((await ordersRepo.payments.listForOrder(db, orderId))[0]?.status).toBe("redirected");
  });

  it.each(["expired", "failed"] as const)("payment-settle reverts a hold after the order becomes %s", async (status) => {
    const { orderId, paymentId, authority } = await paidHeldOrder();
    const settle = vi.fn(async () => ({ ok: true }));
    const reverse = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
    await orderState.transition(db, orderId, status, { actor: { type: "system", id: null }, settings: DEFAULT_SETTINGS });
    const context = ctx({ job: { ...fakeJob({ orderId, paymentId, driver: "snapppay" }), type: "payment.settle" }, drivers: twoPhaseDriver({ settle, reverse }) as unknown as Partial<Drivers> });
    await expect(paymentSettle(context)).rejects.toThrow(/unresolved/);
    await paymentSettle(context);
    expect(reverse).toHaveBeenCalledWith({ authority, providerRef: "PT-1" });
    expect(reverse).toHaveBeenCalledTimes(2);
    expect(settle).not.toHaveBeenCalled();
    expect((await ordersRepo.payments.listForOrder(db, orderId)).find((p) => p.id === paymentId)?.status).toBe("failed");
    expect((await ordersRepo.findById(db, orderId))?.status).toBe(status);
  });

  it.each(["failed", "expired"] as const)("payment-settle does nothing for a closed %s payment", async (status) => {
    const { id } = await pendingOrderOn("instalments");
    const payment = await ordersRepo.payments.insert(db, { orderId: id, driver: "snapppay", amount: 5_000_000, status, authority: `TX-${ulid().slice(-8)}`, refId: "PT-9", cardPanMasked: null, fee: null });
    const settle = vi.fn(async () => ({ ok: true }));
    await paymentSettle(ctx({ job: { ...fakeJob({ orderId: id, paymentId: payment.id, driver: "snapppay" }), type: "payment.settle" }, drivers: twoPhaseDriver({ settle }) as unknown as Partial<Drivers> }));
    expect(settle).not.toHaveBeenCalled();
  });

  // -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - reservation-expire

  it("order-expire closes an abandoned SnappPay page (PENDING) instead of keeping the order for ever", async () => {
    const { orderId, paymentId } = await paidHeldOrder();
    await db.update(orders).set({ expiresAt: new Date(Date.now() - 3_600_000) }).where(eq(orders.id, orderId));
    const reverse = vi.fn(async () => ({ ok: true }));
    const driver = twoPhaseDriver({
      async verify() { return { ok: false, error: "not paid" }; },
      async inquiry() { return { ok: true, status: "PENDING" }; },
      reverse,
    });
    await orderExpire(ctx({ job: { ...fakeJob({}), type: "order.expire" }, drivers: driver as unknown as Partial<Drivers> }));
    const [o] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
    const [p] = await db.select({ status: payments.status }).from(payments).where(eq(payments.id, paymentId));
    expect(o?.status).toBe("expired");
    expect(p?.status).toBe("expired");
    expect(reverse).toHaveBeenCalled();
  });

  it("order-expire leaves a SnappPay order pending while SnappPay cannot be asked (money might be held)", async () => {
    const { orderId } = await paidHeldOrder();
    await db.update(orders).set({ expiresAt: new Date(Date.now() - 3_600_000) }).where(eq(orders.id, orderId));
    const driver = twoPhaseDriver({
      async verify() { return { ok: false, error: "transport" }; },
      async inquiry() { return { ok: false }; },
    });
    await orderExpire(ctx({ job: { ...fakeJob({}), type: "order.expire" }, drivers: driver as unknown as Partial<Drivers> }));
    const [o] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
    expect(o?.status).toBe("pending_payment");
  });

  it("order-expire does not expire a fresh retry from an older attempt's snapshot", async () => {
    const { orderId, paymentId } = await paidHeldOrder();
    await db.update(orders).set({ expiresAt: new Date(Date.now() - 3_600_000) }).where(eq(orders.id, orderId));
    await ordersRepo.payments.update(db, paymentId, { status: "expired" });
    const originalList = ordersRepo.payments.listForOrder.bind(ordersRepo.payments);
    const listing = vi.spyOn(ordersRepo.payments, "listForOrder").mockImplementationOnce(async (...args) => {
      const snapshot = await originalList(...args);
      // A retry commits just after the sweep reads the closed attempt. Its order lock has been
      // released by the time expiry acquires it, so the final decision must reload its payment.
      await ordersRepo.payments.insert(db, { orderId, driver: "snapppay", amount: 5_000_000, status: "redirected", authority: `NEW-${ulid()}`, refId: "PT-NEW", cardPanMasked: null, fee: null });
      return snapshot;
    });
    try {
      await orderExpire(ctx({ job: { ...fakeJob({}), type: "order.expire" }, drivers: twoPhaseDriver() as unknown as Partial<Drivers> }));
      expect((await ordersRepo.findById(db, orderId))?.status).toBe("pending_payment");
      expect((await originalList(db, orderId))[0]?.status).toBe("redirected");
    } finally {
      listing.mockRestore();
    }
  });

  it("payment-settle closes an abandoned SnappPay attempt on an order another job already expired (NL-WV5BB race)", async () => {
    const { orderId, paymentId } = await paidHeldOrder();
    await db.update(orders).set({ status: "expired" }).where(eq(orders.id, orderId));
    const reverse = vi.fn(async () => ({ ok: true }));
    const driver = twoPhaseDriver({
      async verify() { return { ok: false, error: "not paid" }; },
      async inquiry() { return { ok: true, status: "PENDING" }; },
      reverse,
    });
    await paymentSettle(ctx({ job: { ...fakeJob({ orderId, paymentId, driver: "snapppay" }), type: "payment.settle" }, drivers: driver as unknown as Partial<Drivers> }));
    const [p] = await db.select({ status: payments.status }).from(payments).where(eq(payments.id, paymentId));
    expect(p?.status).toBe("expired");
    expect(reverse).toHaveBeenCalled();
  });

  it("order-expire sweeps SnappPay attempts still open on ended orders", async () => {
    const { orderId, paymentId } = await paidHeldOrder();
    await db.update(orders).set({ status: "expired" }).where(eq(orders.id, orderId));
    await db.update(payments).set({ createdAt: new Date(Date.now() - 2 * 3_600_000) }).where(eq(payments.id, paymentId));
    const driver = twoPhaseDriver({ async inquiry() { return { ok: true, status: "REVERT" }; } });
    await orderExpire(ctx({ job: { ...fakeJob({}), type: "order.expire" }, drivers: driver as unknown as Partial<Drivers> }));
    const [p] = await db.select({ status: payments.status }).from(payments).where(eq(payments.id, paymentId));
    expect(p?.status).toBe("expired");
  });

  it("reservation-expire releases the reservation and expires the pending order once", async () => {
    await db.insert(shippingMethods).values({ key: "free_nationwide", name: "ارسال رایگان", kind: "free", rateJson: {}, etaMinDays: 2, etaMaxDays: 7, isActive: true, sort: 0 });
    const [p] = await db.insert(products).values({ slug: `p-${ulid()}`, name: "کالا", displayName: "کالا", status: "active", visibility: "public", price: 5_000_000, stockQty: 3 }).returning({ id: products.id });
    const customerId = ulid();
    await db.insert(customers).values({ id: customerId, phone: "09121234567", referralCode: ulid().slice(-8) });

    const req = {
      quoteSig: "0".repeat(64),
      lines: [{ productId: p!.id, qty: 1 }],
      shippingKey: "free_nationwide",
      address: { label: "خانه", recipientName: "علی", recipientPhone: "09121110000", province: "THR" as const, city: "تهران", address: "خیابان الف مجتمع بلورین", plaque: "۶۴۲", unit: "۲", postcode: "1234567890", isDefault: false },
      paymentMethod: "zarinpal" as const,
    };
    const placeCtx = {
      customerId,
      phone: "09121110000",
      ip: "1.2.3.4",
      ua: "test",
      settings: DEFAULT_SETTINGS,
      env: { SITE_ORIGIN: "https://namilux.ir", QUOTE_SIGNING_KEY: KEY, PAYMENT_DRIVER: "mock" as const },
      channel: "main" as const,
      drivers: { payment: () => mockDriver },
    };
    const { order } = await placeOrder(db, req, placeCtx);
    expect(order.status).toBe("pending_payment");

    // Age the reservation past the grace window, and age the fresh redirected payment past the
    // LATE_PAYMENT_GRACE_MS window so releaseExpired stops holding the reservation open.
    const past = new Date(Date.now() - 24 * 3600 * 1000);
    await db.update(inventoryReservations).set({ expiresAt: past }).where(eq(inventoryReservations.orderId, order.id));
    await db.update(payments).set({ createdAt: past }).where(eq(payments.orderId, order.id));

    await reservationExpire(ctx({ job: { ...fakeJob({}), type: "reservation.expire" } }));

    const after = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, order.id)).limit(1);
    expect(after[0]?.status).toBe("expired");
    // The expired transition enqueues one order.expired SMS.
    const smsJobs = await db.select({ id: jobsTable.id }).from(jobsTable).where(and(eq(jobsTable.type, "sms.send"), eq(jobsTable.uniqueKey, `sms:${order.id}:order.expired`)));
    expect(smsJobs).toHaveLength(1);
  });

  // -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - cache-revalidate

  it("cache-revalidate signs the internal request and enqueues cdn.purge", async () => {
    const tags = ["product:1044", "catalog"];
    let captured: { url: string; ts: string; sig: string; body: string; host: string; fwdHost: string; proto: string } | null = null;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const headers = new Headers(init?.headers);
      captured = {
        url: (url as string),
        ts: headers.get("x-nl-ts") ?? "",
        sig: headers.get("x-nl-sig") ?? "",
        body: (init?.body as string),
        host: headers.get("host") ?? "",
        fwdHost: headers.get("x-forwarded-host") ?? "",
        proto: headers.get("x-forwarded-proto") ?? "",
      };
      return new Response(JSON.stringify({ revalidated: tags.length }), { status: 200 });
    });

    await cacheRevalidate(ctx({ job: { ...fakeJob({ tags }), type: "cache.revalidate" } }));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Over loopback - Caddy answers 404 for /api/internal/* on the public hostname - but addressed
    // as the canonical host, or the storefront's proxy would 301 the POST to SITE_ORIGIN.
    expect(captured!.url).toBe("http://127.0.0.1:3000/api/internal/revalidate/");
    expect(captured!.host).toBe("namilux.ir");
    expect(captured!.fwdHost).toBe("namilux.ir");
    expect(captured!.proto).toBe("https");
    // The signature must be exactly what apps/web verifyInternalHmac recomputes.
    const expected = createHmac("sha256", KEY).update(`${captured!.ts}.${captured!.body}`).digest("hex");
    expect(captured!.sig).toBe(expected);
    // A follow-up cdn.purge job carries the same tags.
    const purge = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.type, "cdn.purge"));
    expect(purge.length).toBeGreaterThanOrEqual(1);
  });

  // -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - jobs-prune

  it("jobs-prune clears finished rows past their retention and logs the counts", async () => {
    const daysAgo = (n: number): Date => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
    const row = (id: string, status: "done" | "dead" | "queued", days: number): typeof jobsTable.$inferInsert => ({
      id,
      type: "cache.revalidate",
      payloadJson: {},
      status,
      runAt: daysAgo(days),
      ...(status === "queued" ? {} : { finishedAt: daysAgo(days) }),
    });
    const staleDone = ulid();
    const staleDead = ulid();
    const freshDone = ulid();
    const oldQueued = ulid();
    await db.insert(jobsTable).values([
      row(staleDone, "done", 10),
      row(staleDead, "dead", 40),
      row(freshDone, "done", 2),
      // Age alone never deletes work that has not finished.
      row(oldQueued, "queued", 90),
    ]);

    const lines: { obj: object; msg?: string }[] = [];
    const log: Logger = { info: (obj, msg) => lines.push({ obj, ...(msg === undefined ? {} : { msg }) }), warn: () => {}, error: () => {} };
    await jobsPrune({ ...ctx({ job: { ...fakeJob({}), type: "jobs.prune" } }), log });

    const left = (await db.select({ id: jobsTable.id }).from(jobsTable)).map((r) => r.id);
    expect(left.sort()).toEqual([freshDone, oldQueued].sort());
    expect(lines[0]?.obj).toMatchObject({ done: 1, dead: 1, capped: false });
    expect(lines[0]?.msg).toBe("jobs pruned");

    // Idempotent: running it again changes nothing.
    await jobsPrune({ ...ctx({ job: { ...fakeJob({}), type: "jobs.prune" } }), log });
    expect(lines[1]?.obj).toMatchObject({ done: 0, dead: 0 });
    expect(await db.select({ id: jobsTable.id }).from(jobsTable)).toHaveLength(2);
  });

  // -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  -  - idempotency by unique_key (jobs)

  it("enqueue is idempotent by unique_key", async () => {
    const a = await jobs.enqueue(db, "telegram.notify", { event: "x" }, { uniqueKey: "tg:dup" });
    const b = await jobs.enqueue(db, "telegram.notify", { event: "y" }, { uniqueKey: "tg:dup" });
    expect(b).toBe(a);
  });
});
