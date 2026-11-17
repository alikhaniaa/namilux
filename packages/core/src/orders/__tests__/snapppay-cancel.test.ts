import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, orders as ordersTable, payments as paymentsTable } from "@namilux/db";
import { createTestDb, hasTestDb, seedMinimal, truncateAll, type TestDb } from "@namilux/db/test";
import { SETTINGS, paidOrder, staffActor } from "../../__tests__/support/fixtures";
import { loyalty } from "../../loyalty/ledger";
import { cancelByStaff } from "../admin";
import { cancelByCustomer, requestReturn } from "../tracking";
import { decideReturn } from "../returns";
import { orderState } from "../state";
import { orderEvents } from "../events";
import { findById, refunds } from "../repo";
import { refund } from "../refunds";
import type { PaymentDriver } from "../payments";

describe.skipIf(!hasTestDb())("paid SnappPay cancellation", () => {
  let handle: TestDb;
  beforeAll(async () => { handle = await createTestDb(); });
  afterEach(async () => { await truncateAll(handle.db); });
  afterAll(async () => { await handle.close(); });

  async function fresh(driver: "snapppay" | "zarinpal" = "snapppay") {
    const seed = await seedMinimal(handle.db);
    const actor = await staffActor(handle.db);
    const order = await paidOrder(handle.db, seed, actor);
    await handle.db.update(paymentsTable).set({ driver, refId: "PT-CANCEL" }).where(eq(paymentsTable.orderId, order.id));
    return { order, actor, customerId: seed.customerId };
  }

  function gateway(refundFn: NonNullable<PaymentDriver["refund"]>) {
    const driver: PaymentDriver = {
      key: "snapppay",
      request: async () => ({ ok: false, error: "unused" }),
      verify: async () => ({ ok: false, error: "unused" }),
      refund: refundFn,
    };
    return { settings: SETTINGS, restock: true, drivers: { payment: () => driver } };
  }

  it.each(["paid", "processing"] as const)("staff must refund a %s SnappPay order first", async (status) => {
    const { order, actor, customerId } = await fresh();
    if (status === "processing") await orderState.transition(handle.db, order.id, status, { actor, settings: SETTINGS });
    const balance = await loyalty.balance(handle.db, customerId);
    await expect(cancelByStaff(handle.db, order.id, "انصراف", true, actor, { settings: SETTINGS })).rejects.toThrow(/«بازپرداخت»/);
    expect((await findById(handle.db, order.id))?.status).toBe(status);
    expect(await loyalty.balance(handle.db, customerId)).toBe(balance);
    expect(await refunds.listForOrder(handle.db, order.id)).toEqual([]);
    expect((await orderEvents.list(handle.db, order.id)).some((e) => e.type === "status.cancelled")).toBe(false);

    const refundFn = vi.fn(async () => ({ ok: true, ref: "CANCELLED" }));
    const result = await refund(handle.db, order.id, order.grandTotal, "انصراف", actor, "gateway", gateway(refundFn));
    expect(result.status).toBe("done");
    expect(refundFn).toHaveBeenCalledWith(expect.objectContaining({ refId: "PT-CANCEL", amount: order.grandTotal, remainingAmount: 0, full: true }));
    expect((await findById(handle.db, order.id))?.status).toBe("refunded");
    expect(await loyalty.balance(handle.db, customerId)).toBe(0);
  });

  it("customer cancellation directs a paid SnappPay shopper to support without changing the order", async () => {
    const { order, customerId } = await fresh();
    await expect(cancelByCustomer(handle.db, order.code, customerId, "انصراف", { settings: SETTINGS })).rejects.toThrow(/پشتیبانی.*بازپرداخت/);
    expect((await findById(handle.db, order.id))?.status).toBe("paid");
    expect((await orderEvents.list(handle.db, order.id)).some((e) => e.type === "refund.requested" || e.type === "status.cancelled")).toBe(false);
  });

  it.each(["failure", "timeout"])("gateway %s during the required refund preserves the claim and blocks cancellation", async (outcome) => {
    const { order, actor, customerId } = await fresh();
    const refundFn = vi.fn(async () => {
      if (outcome === "timeout") throw new Error("transport timeout");
      return { ok: false };
    });
    const ctx = gateway(refundFn);
    const result = await refund(handle.db, order.id, order.grandTotal, "انصراف", actor, "gateway", ctx);
    expect(result.status).toBe("processing");
    expect(await refunds.listForOrder(handle.db, order.id)).toMatchObject([{ id: result.id, status: "processing", amount: order.grandTotal }]);
    await expect(cancelByStaff(handle.db, order.id, "انصراف", true, actor, ctx)).rejects.toThrow(/بازپرداخت/);
    await expect(cancelByCustomer(handle.db, order.code, customerId, "انصراف", ctx)).rejects.toThrow(/بازپرداخت/);
    await expect(refund(handle.db, order.id, order.grandTotal, "تلاش دوباره", actor, "gateway", ctx)).rejects.toThrow(/در حال بررسی/);
    await expect(refund(handle.db, order.id, order.grandTotal, "دستی", actor, "manual", ctx)).rejects.toThrow(/از طریق خود درگاه/);
    expect(refundFn).toHaveBeenCalledTimes(1);
    expect((await findById(handle.db, order.id))?.status).toBe("paid");
  });

  it("after a partial update, staff must refund only the remaining amount through full cancel", async () => {
    const { order, actor } = await fresh();
    const refundFn = vi.fn(async () => ({ ok: true }));
    const ctx = gateway(refundFn);
    const partial = Math.floor(order.grandTotal / 2);
    await refund(handle.db, order.id, partial, "بازپرداخت جزئی", actor, "gateway", ctx);
    await expect(cancelByStaff(handle.db, order.id, "انصراف", true, actor, ctx)).rejects.toThrow(/بازپرداخت/);
    await refund(handle.db, order.id, order.grandTotal - partial, "انصراف", actor, "gateway", ctx);
    expect(refundFn).toHaveBeenLastCalledWith(expect.objectContaining({ amount: order.grandTotal - partial, remainingAmount: 0, full: true }));
    expect((await findById(handle.db, order.id))?.status).toBe("refunded");
  });

  it("an accepted return of a SnappPay order refunds through SnappPay; a manual refund is refused before the order changes", async () => {
    const { order, actor, customerId } = await fresh();
    await handle.db.update(ordersTable).set({ status: "delivered", deliveredAt: new Date(Date.now() - 86_400_000) }).where(eq(ordersTable.id, order.id));
    const { id } = await requestReturn(handle.db, order.code, customerId, { orderCode: order.code, reason: "کالا با توضیحات سایت هم‌خوانی نداشت" });
    const refundFn = vi.fn(async () => ({ ok: true }));
    const ctx = gateway(refundFn);
    await expect(decideReturn(handle.db, id, { decision: "accept", restock: true, refundAmount: order.grandTotal, via: "manual" }, actor, ctx)).rejects.toThrow(/از طریق خود درگاه/);
    expect((await findById(handle.db, order.id))?.status).toBe("delivered");
    // No `via` given: a SnappPay purchase goes back through SnappPay by itself.
    await decideReturn(handle.db, id, { decision: "accept", restock: true, refundAmount: order.grandTotal }, actor, ctx);
    expect(refundFn).toHaveBeenCalledWith(expect.objectContaining({ refId: "PT-CANCEL", full: true }));
    expect(await refunds.listForOrder(handle.db, order.id)).toMatchObject([{ status: "done", amount: order.grandTotal }]);
    expect(await loyalty.balance(handle.db, customerId)).toBe(0);
  });

  it.each(["staff", "customer"])("ZarinPal %s cancellation remains local without a gateway refund", async (by) => {
    const { order, actor, customerId } = await fresh("zarinpal");
    const cancelled = by === "staff"
      ? await cancelByStaff(handle.db, order.id, "انصراف", true, actor, { settings: SETTINGS })
      : await cancelByCustomer(handle.db, order.code, customerId, "انصراف", { settings: SETTINGS });
    expect(cancelled.status).toBe("cancelled");
    expect(await refunds.listForOrder(handle.db, order.id)).toEqual([]);
    const requested = (await orderEvents.list(handle.db, order.id)).some((e) => e.type === "refund.requested");
    expect(requested).toBe(by === "customer");
  });
});
