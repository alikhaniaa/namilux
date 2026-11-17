import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inventoryReservations, orders, products } from "@namilux/db";
import { createTestDb, hasTestDb, seedMinimal, truncateAll, type TestDb } from "@namilux/db/test";
import { pendingOrder, SETTINGS, SITE_ORIGIN, staffActor } from "../../__tests__/support/fixtures";
import { ulid } from "../../ids";
import { loyalty } from "../../loyalty/ledger";
import { retryPayment, startPayment, type PaymentDriver } from "../payments";
import { findById, payments as paymentsRepo } from "../repo";
import { orderState } from "../state";

describe.skipIf(!hasTestDb())("payment retry", () => {
  let handle: TestDb;
  beforeAll(async () => { handle = await createTestDb(); });
  afterEach(async () => { await truncateAll(handle.db); });
  afterAll(async () => { await handle.close(); });

  async function failedDiscountedOrder() {
    const seed = await seedMinimal(handle.db);
    const actor = await staffActor(handle.db);
    const order = await pendingOrder(handle.db, seed, actor);
    await loyalty.award(handle.db, seed.customerId, "review", 200);
    await handle.db.update(orders).set({ pointsRedeemed: 100, pointsDiscount: 100_000, grandTotal: order.grandTotal - 100_000 }).where(eq(orders.id, order.id));
    await loyalty.redeemForOrder(handle.db, seed.customerId, order.id, 100);
    await orderState.transition(handle.db, order.id, "failed", { actor, settings: SETTINGS });
    expect(await loyalty.balance(handle.db, seed.customerId)).toBe(200);
    return { order, actor, customerId: seed.customerId };
  }

  function context(customerId: string) {
    const request = vi.fn<PaymentDriver["request"]>(async () => ({ ok: true, authority: ulid(), redirectUrl: "https://gateway.test/pay" }));
    const driver: PaymentDriver = { key: "mock", request, verify: async () => ({ ok: false }) };
    return { request, ctx: { customerId, settings: SETTINGS, env: { SITE_ORIGIN }, drivers: { payment: () => driver } } };
  }

  it("reclaims a released discount on each retry and releases it on each failure", async () => {
    const { order, actor, customerId } = await failedDiscountedOrder();
    const { request, ctx } = context(customerId);
    await retryPayment(handle.db, order.id, ctx);
    expect(await loyalty.balance(handle.db, customerId)).toBe(100);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ amount: order.grandTotal - 100_000 }));
    await orderState.transition(handle.db, order.id, "failed", { actor, settings: SETTINGS });
    expect(await loyalty.balance(handle.db, customerId)).toBe(200);
    await retryPayment(handle.db, order.id, ctx);
    expect(await loyalty.balance(handle.db, customerId)).toBe(100);
  });

  it("insufficient points refuses the retry and rolls back new stock reservations", async () => {
    const { order, actor, customerId } = await failedDiscountedOrder();
    await loyalty.adjust(handle.db, customerId, -200, "امتیاز در خرید دیگری مصرف شد", actor);
    const { request, ctx } = context(customerId);
    await expect(retryPayment(handle.db, order.id, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(request).not.toHaveBeenCalled();
    expect((await findById(handle.db, order.id))?.status).toBe("failed");
    const reservations = await handle.db.select().from(inventoryReservations).where(eq(inventoryReservations.orderId, order.id));
    expect(reservations.filter((r) => r.releasedAt === null && r.consumedAt === null)).toHaveLength(0);
    expect(await loyalty.balance(handle.db, customerId)).toBe(0);
  });

  async function snappOrder(channel: "main" | "instalments" = "main") {
    const seed = await seedMinimal(handle.db);
    const actor = await staffActor(handle.db);
    const order = await pendingOrder(handle.db, seed, actor);
    await handle.db.update(products).set({ instalmentEligible: true }).where(eq(products.id, seed.productId));
    await handle.db.update(orders).set({ channel }).where(eq(orders.id, order.id));
    await paymentsRepo.insert(handle.db, { orderId: order.id, driver: "snapppay", amount: order.grandTotal, status: "failed", authority: ulid(), refId: "old-token", cardPanMasked: null, fee: null });
    return { order: (await findById(handle.db, order.id))!, actor, customerId: seed.customerId };
  }

  it("a historical instalments order retries on its original gateway", async () => {
    const { order, actor, customerId } = await snappOrder("instalments");
    await orderState.transition(handle.db, order.id, "failed", { actor, settings: SETTINGS });
    const request = vi.fn<PaymentDriver["request"]>(async () => ({ ok: true, authority: ulid(), providerRef: "new-token", redirectUrl: "https://gateway.test/pay" }));
    const driver: PaymentDriver = { key: "snapppay", request, verify: async () => ({ ok: false }) };
    const payment = vi.fn(() => driver);
    await expect(retryPayment(handle.db, order.id, { customerId, settings: SETTINGS, env: { SITE_ORIGIN }, drivers: { payment } })).resolves.toEqual({ redirectUrl: "https://gateway.test/pay" });
    expect(payment).toHaveBeenCalledExactlyOnceWith("snapppay");
    expect(request).toHaveBeenCalledTimes(1);
    expect((await findById(handle.db, order.id))?.channel).toBe("instalments");
    expect((await paymentsRepo.listForOrder(handle.db, order.id)).filter((p) => p.status === "redirected")).toHaveLength(1);
  });

  it("concurrent retry clicks request only one SnappPay token", async () => {
    const { order, customerId } = await snappOrder();
    let signalRequested = (): void => {};
    let finishRequest = (): void => {};
    const requested = new Promise<void>((resolve) => { signalRequested = resolve; });
    const proceed = new Promise<void>((resolve) => { finishRequest = resolve; });
    const request = vi.fn<PaymentDriver["request"]>(async () => {
      signalRequested();
      await proceed;
      return { ok: true, authority: ulid(), providerRef: "only-token", redirectUrl: "https://gateway.test/pay" };
    });
    const driver: PaymentDriver = { key: "snapppay", request, verify: async () => ({ ok: false }) };
    const ctx = { customerId, settings: SETTINGS, env: { SITE_ORIGIN }, drivers: { payment: () => driver } };
    const first = retryPayment(handle.db, order.id, ctx);
    await requested;
    const second = retryPayment(handle.db, order.id, ctx);
    const completed = Promise.allSettled([first, second]);
    finishRequest();
    const results = await completed;
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(request).toHaveBeenCalledTimes(1);
    expect((await paymentsRepo.listForOrder(handle.db, order.id)).filter((p) => p.status === "redirected")).toHaveLength(1);
  });

  it("a failed token request persists closed history and permits a later attempt", async () => {
    const { order } = await snappOrder();
    const request = vi.fn<PaymentDriver["request"]>()
      .mockRejectedValueOnce(new Error("transport"))
      .mockResolvedValue({ ok: true, authority: ulid(), providerRef: "retry-token", redirectUrl: "https://gateway.test/pay" });
    const driver: PaymentDriver = { key: "snapppay", request, verify: async () => ({ ok: false }) };
    await expect(startPayment(handle.db, order, driver, { SITE_ORIGIN })).rejects.toMatchObject({ code: "PAYMENT_FAILED" });
    expect((await paymentsRepo.listForOrder(handle.db, order.id))).toHaveLength(2);
    expect((await paymentsRepo.listForOrder(handle.db, order.id)).every((p) => p.status === "failed")).toBe(true);
    await expect(startPayment(handle.db, order, driver, { SITE_ORIGIN })).resolves.toMatchObject({ payment: { status: "redirected", refId: "retry-token" } });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
