import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inventoryMovements, inventoryReservations, orderItems, orders, payments, products } from "@namilux/db";
import { createTestDb, hasTestDb, seedMinimal, truncateAll, type TestDb } from "@namilux/db/test";
import { DEFAULT_SETTINGS, availableStock, availableStockMany, findCardSources, handleCallback, loadProductsForQuote, loyalty, releaseExpired, reserve, ulid, type PaymentDriver } from "@namilux/core";
import { reservationExpire } from "../handlers/reservation-expire";
import type { HandlerCtx } from "../runtime";

describe.skipIf(!hasTestDb())("reservation expiry and payment serialization", () => {
  let handle: TestDb;
  beforeAll(async () => { handle = await createTestDb(); });
  afterEach(async () => { vi.restoreAllMocks(); await truncateAll(handle.db); });
  afterAll(async () => { await handle.close(); });

  async function fixture() {
    const seed = await seedMinimal(handle.db);
    await handle.db.update(products).set({ stockQty: 1 }).where(eq(products.id, seed.productId));
    const orderId = ulid();
    const authority = ulid();
    const past = new Date(Date.now() - 3_600_000);
    await handle.db.insert(orders).values({ id: orderId, code: "NL-ABCDE", phone: "09121234567", customerId: seed.customerId, status: "pending_payment", subtotal: 1_000_000, grandTotal: 1_000_000, expiresAt: past });
    await handle.db.insert(orderItems).values({ id: ulid(), orderId, productId: seed.productId, name: "کالا", unitPrice: 1_000_000, qty: 1, lineTotal: 1_000_000 });
    await handle.db.transaction((tx) => reserve(tx, orderId, [{ productId: seed.productId, qty: 1 }], 30));
    await handle.db.update(inventoryReservations).set({ expiresAt: past }).where(eq(inventoryReservations.orderId, orderId));
    await handle.db.insert(payments).values({ id: ulid(), orderId, driver: "mock", amount: 1_000_000, status: "redirected", authority, createdAt: past });
    const [product] = await handle.db.select({ stockQty: products.stockQty }).from(products).where(eq(products.id, seed.productId));
    return { ...seed, orderId, authority, initialStock: product?.stockQty ?? 0 };
  }

  function context(): HandlerCtx {
    return {
      db: handle.db, log: { info: () => {}, warn: () => {}, error: () => {} },
      drivers: {} as HandlerCtx["drivers"], env: {} as HandlerCtx["env"],
      job: { id: ulid(), type: "reservation.expire", payload: {}, status: "running", runAt: new Date().toISOString(), attempts: 0, maxAttempts: 5, lastError: null, lockedBy: "test", lockedAt: null, uniqueKey: null, createdAt: new Date().toISOString(), finishedAt: null },
      signal: new AbortController().signal,
    };
  }

  it("a callback verifying during expiry consumes stock exactly once instead of losing its reservation", async () => {
    const f = await fixture();
    let verified = (): void => {};
    let finish = (): void => {};
    let sweeping = (): void => {};
    const verifying = new Promise<void>((resolve) => { verified = resolve; });
    const proceed = new Promise<void>((resolve) => { finish = resolve; });
    const sweepEnteredTransaction = new Promise<void>((resolve) => { sweeping = resolve; });
    const driver: PaymentDriver = {
      key: "mock", request: async () => ({ ok: false, error: "unused" }),
      verify: async () => { verified(); await proceed; return { ok: true, refId: "receipt", alreadyVerified: false }; },
    };
    const callback = handleCallback(handle.db, "mock", { Authority: f.authority, Status: "OK" }, { drivers: { payment: () => driver }, settings: DEFAULT_SETTINGS, ip: "127.0.0.1" });
    await verifying;
    // Synchronize on the actual sweep transaction, not a sleep. Before the fix the bulk release
    // had already committed by this point; now this transaction must first acquire the order lock.
    const transact = handle.db.transaction.bind(handle.db);
    const transactionSpy = vi.spyOn(handle.db, "transaction").mockImplementation((work, config) => {
      sweeping();
      return transact(work, config);
    });
    const sweep = reservationExpire(context());
    try {
      await sweepEnteredTransaction;
      // The in-flight callback also holds the last unit against OTHER orders, even past grace.
      expect(await availableStock(handle.db, f.productId)).toBe(0);
      const competingOrder = ulid();
      await handle.db.insert(orders).values({ id: competingOrder, code: "NL-OTHER", phone: "09121234567" });
      await expect(handle.db.transaction((tx) => reserve(tx, competingOrder, [{ productId: f.productId, qty: 1 }], 30))).rejects.toMatchObject({ code: "OUT_OF_STOCK" });
    } finally {
      transactionSpy.mockRestore();
      finish();
      await Promise.all([callback, sweep]);
    }
    expect(await callback).toMatchObject({ ok: true });
    const [order] = await handle.db.select({ status: orders.status }).from(orders).where(eq(orders.id, f.orderId));
    const [product] = await handle.db.select({ stockQty: products.stockQty }).from(products).where(eq(products.id, f.productId));
    const held = await handle.db.select().from(inventoryReservations).where(eq(inventoryReservations.orderId, f.orderId));
    const sold = await handle.db.select().from(inventoryMovements).where(and(eq(inventoryMovements.orderId, f.orderId), eq(inventoryMovements.reason, "sale")));
    expect(order?.status).toBe("paid");
    expect(product?.stockQty).toBe(f.initialStock - 1);
    expect(sold).toHaveLength(1);
    expect(held[0]?.releasedAt).toBeNull();
    expect(held[0]?.consumedAt).toBeInstanceOf(Date);
  });

  it("a fresh redirect protects the last unit after its deadline until atomic expiry releases it", async () => {
    const f = await fixture();
    await handle.db.update(payments).set({ createdAt: new Date() }).where(eq(payments.orderId, f.orderId));
    const competingOrder = ulid();
    await handle.db.insert(orders).values({ id: competingOrder, code: "NL-OTHER", phone: "09121234567" });
    const attempt = () => handle.db.transaction((tx) => reserve(tx, competingOrder, [{ productId: f.productId, qty: 1 }], 30));
    // Checkout quote, individual/batch stock lookups and storefront cards agree on the hold.
    expect((await loadProductsForQuote(handle.db, [f.productId], { lock: "none" }))[0]?.reserved).toBe(1);
    expect((await findCardSources(handle.db, [f.productId]))[0]?.reservedQty).toBe(1);
    expect(await availableStock(handle.db, f.productId)).toBe(0);
    expect((await availableStockMany(handle.db, [f.productId])).get(f.productId)).toBe(0);
    await expect(attempt()).rejects.toMatchObject({ code: "OUT_OF_STOCK" });
    await reservationExpire(context()); // redirect is still inside its grace window
    expect(await availableStock(handle.db, f.productId)).toBe(0);
    await expect(attempt()).rejects.toMatchObject({ code: "OUT_OF_STOCK" });
    await handle.db.update(payments).set({ createdAt: new Date(Date.now() - 3_600_000) }).where(eq(payments.orderId, f.orderId));
    await reservationExpire(context());
    const [order] = await handle.db.select({ status: orders.status }).from(orders).where(eq(orders.id, f.orderId));
    expect(order?.status).toBe("expired");
    expect(await availableStock(handle.db, f.productId)).toBe(1);
    await expect(attempt()).resolves.toBeUndefined();
    expect(await availableStock(handle.db, f.productId)).toBe(0);
  });

  it("an expiry winner atomically ends the order and releases its discount exactly once", async () => {
    const f = await fixture();
    await loyalty.award(handle.db, f.customerId, "review", 10);
    await loyalty.redeemForOrder(handle.db, f.customerId, f.orderId, 10);
    await reservationExpire(context());
    const [order] = await handle.db.select({ status: orders.status }).from(orders).where(eq(orders.id, f.orderId));
    const held = await handle.db.select().from(inventoryReservations).where(eq(inventoryReservations.orderId, f.orderId));
    expect(order?.status).toBe("expired");
    expect(held[0]?.releasedAt).toBeInstanceOf(Date);
    expect(await loyalty.balance(handle.db, f.customerId)).toBe(10);
    await reservationExpire(context());
    expect(await loyalty.balance(handle.db, f.customerId)).toBe(10);
  });

  it("leaves a pending order intact without an atomic expiry action and rolls back a failed action", async () => {
    const f = await fixture();
    expect(await releaseExpired(handle.db, new Date(), 0)).toEqual({ orderIds: [] });
    await expect(releaseExpired(handle.db, new Date(), 0, async () => { throw new Error("expiry failed"); })).rejects.toThrow("expiry failed");
    const [held] = await handle.db.select().from(inventoryReservations).where(eq(inventoryReservations.orderId, f.orderId));
    const [order] = await handle.db.select({ status: orders.status }).from(orders).where(eq(orders.id, f.orderId));
    expect(held?.releasedAt).toBeNull();
    expect(order?.status).toBe("pending_payment");
  });
});
