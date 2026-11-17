import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, hasTestDb, seedMinimal, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { eq, jobs as jobsTable, orders as ordersTable } from "@namilux/db";
import { SETTINGS, paidOrder, staffActor } from "../../__tests__/support/fixtures";
import { loyalty } from "../../loyalty/ledger";
import type { Actor, Order } from "../../types";
import type { PaymentDriver } from "../payments";
import * as ordersRepo from "../repo";
import { findById } from "../repo";
import { listRefunds, refund, refundable } from "../refunds";

describe.skipIf(!hasTestDb())("refunds", () => {
  let handle: TestDb;
  let actor: Actor;
  let order: Order;
  let customerId: string;

  beforeAll(async () => {
    handle = await createTestDb();
  });
  afterEach(async () => {
    await truncateAll(handle.db);
  });
  afterAll(async () => {
    await handle.close();
  });

  async function fresh(): Promise<void> {
    const seed = await seedMinimal(handle.db);
    actor = await staffActor(handle.db);
    customerId = seed.customerId;
    order = await paidOrder(handle.db, { productId: seed.productId, customerId }, actor);
  }

  it("refund above refundable amount is rejected", async () => {
    await fresh();
    expect(refundable(order, 0)).toBe(order.grandTotal);
    expect(refundable(order, 1_000)).toBe(order.grandTotal - 1_000);
    await expect(refund(handle.db, order.id, order.grandTotal + 1, "زیاد", actor, "manual", { settings: SETTINGS })).rejects.toThrow();
    await expect(refund(handle.db, order.id, 0, "صفر", actor, "manual", { settings: SETTINGS })).rejects.toThrow();
    expect(await listRefunds(handle.db, order.id)).toEqual([]);
  });

  it("full refund transitions the order to refunded and reverses points", async () => {
    await fresh();
    const earned = await loyalty.balance(handle.db, customerId);
    expect(earned).toBeGreaterThan(0); // the paid transition earned the points
    expect(order.pointsEarned).toBe(earned);
    const row = await refund(handle.db, order.id, order.grandTotal, "انصراف مشتری", actor, "manual", { settings: SETTINGS });
    expect(row.status).toBe("done");
    expect((await findById(handle.db, order.id))?.status).toBe("refunded");
    expect(await loyalty.balance(handle.db, customerId)).toBe(0);
    const sms = (await handle.db.select().from(jobsTable)).filter((j) => j.type === "sms.send" && j.payloadJson["template"] === "order.cancelled");
    expect(sms).toHaveLength(1);
    // nothing is left to refund
    expect(refundable((await findById(handle.db, order.id)) ?? order, order.grandTotal)).toBe(0);
  });

  it("partial refund keeps status and adjusts points proportionally", async () => {
    await fresh();
    const earned = await loyalty.balance(handle.db, customerId);
    const half = Math.round(order.grandTotal / 2);
    const row = await refund(handle.db, order.id, half, "یک قلم مرجوع شد", actor, "manual", { settings: SETTINGS });
    expect(row.status).toBe("done");
    expect(row.amount).toBe(half);
    expect((await findById(handle.db, order.id))?.status).toBe("paid");
    expect(await loyalty.balance(handle.db, customerId)).toBe(earned - Math.round((earned * half) / order.grandTotal));
    expect(refundable(order, half)).toBe(order.grandTotal - half);
    // the remainder can still be refunded, and no more than that
    await expect(refund(handle.db, order.id, order.grandTotal - half + 1, "زیاد", actor, "manual", { settings: SETTINGS })).rejects.toThrow();
  });

  it.each(["paid", "returned"] as const)("partial then full refund of a %s order reverses each earned point once", async (status) => {
    await fresh();
    if (status === "returned") await handle.db.update(ordersTable).set({ status }).where(eq(ordersTable.id, order.id));
    const half = Math.floor(order.grandTotal / 2);
    await refund(handle.db, order.id, half, "بخشی از خرید", actor, "manual", { settings: SETTINGS });
    const last = await refund(handle.db, order.id, order.grandTotal - half, "باقی‌مانده", actor, "manual", { settings: SETTINGS });
    expect(last.status).toBe("done");
    expect(last.doneAt).not.toBeNull();
    expect((await findById(handle.db, order.id))?.status).toBe(status === "returned" ? "returned" : "refunded");
    expect(await loyalty.balance(handle.db, customerId)).toBe(0);
  });

  it("split partial refunds use cumulative rounding", async () => {
    await fresh();
    const earned = order.pointsEarned;
    // Each piece is half a point: rounding each one independently would take back two points.
    const piece = Math.floor(order.grandTotal / earned / 2);
    await refund(handle.db, order.id, piece, "اول", actor, "manual", { settings: SETTINGS });
    await refund(handle.db, order.id, piece, "دوم", actor, "manual", { settings: SETTINGS });
    expect(await loyalty.balance(handle.db, customerId)).toBe(earned - Math.round(earned * piece * 2 / order.grandTotal));
  });

  it("a return completed during the gateway call cannot strand a successful refund", async () => {
    await fresh();
    await handle.db.update(ordersTable).set({ status: "delivered" }).where(eq(ordersTable.id, order.id));
    const driver: PaymentDriver = {
      key: "mock",
      request: async () => ({ ok: false, error: "unused" }),
      verify: async () => ({ ok: false, error: "unused" }),
      refund: async () => {
        await handle.db.update(ordersTable).set({ status: "returned" }).where(eq(ordersTable.id, order.id));
        return { ok: true };
      },
    };
    const result = await refund(handle.db, order.id, order.grandTotal, "مرجوعی", actor, "gateway", { settings: SETTINGS, drivers: { payment: () => driver } });
    expect(result.status).toBe("done");
    expect((await listRefunds(handle.db, order.id))[0]?.status).toBe("done");
    expect((await findById(handle.db, order.id))?.status).toBe("returned");
    expect(await loyalty.balance(handle.db, customerId)).toBe(0);
  });

  it("an all-or-nothing gateway refuses a PARTIAL refund before anything is written", async () => {
    await fresh();
    // A full-only driver must refuse a smaller amount instead of returning everything.
    // SnappPay itself now supports partial refunds through update.
    const refundFn = vi.fn(async () => ({ ok: true as const, ref: "X" }));
    const driver = {
      key: "mock",
      request: async () => ({ ok: false as const, error: "n/a" }),
      verify: async () => ({ ok: false as const, error: "n/a" }),
      refundsInFullOnly: true,
      refund: refundFn,
    } as unknown as PaymentDriver;
    const ctx = { drivers: { payment: () => driver }, settings: SETTINGS };

    await expect(refund(handle.db, order.id, Math.round(order.grandTotal / 2), "یک قلم", actor, "gateway", ctx)).rejects.toThrow(/بازپرداخت کامل/);
    expect(refundFn).not.toHaveBeenCalled();
    expect(await listRefunds(handle.db, order.id)).toEqual([]); // refused, not recorded as failed
    expect((await findById(handle.db, order.id))?.status).toBe("paid");

    // The whole amount goes through, and the driver is told it clears the order.
    const row = await refund(handle.db, order.id, order.grandTotal, "انصراف", actor, "gateway", ctx);
    expect(row.status).toBe("done");
    expect(refundFn).toHaveBeenCalledWith(expect.objectContaining({ full: true, amount: order.grandTotal }));
  });

  it("a payment with no provider reference is refused rather than sent with its authority", async () => {
    await fresh();
    // The authority is not a usable stand-in: ZarinPal resolves a refund session from the ref_id and
    // SnappPay's cancel takes the paymentToken, so a blank one can only be rejected downstream.
    const succeeded = (await ordersRepo.payments.listForOrder(handle.db, order.id)).find((p) => p.status === "succeeded");
    await ordersRepo.payments.update(handle.db, succeeded!.id, { refId: null });
    const driver = {
      key: "zarinpal",
      request: async () => ({ ok: false as const, error: "n/a" }),
      verify: async () => ({ ok: false as const, error: "n/a" }),
      refund: async () => ({ ok: true as const, ref: "X" }),
    } as unknown as PaymentDriver;
    await expect(
      refund(handle.db, order.id, order.grandTotal, "بدون مرجع", actor, "gateway", { drivers: { payment: () => driver }, settings: SETTINGS }),
    ).rejects.toThrow(/شناسهٔ مرجع/);
    expect(await listRefunds(handle.db, order.id)).toEqual([]);
  });

  it("gateway refund failure leaves the order unchanged", async () => {
    await fresh();
    const before = await loyalty.balance(handle.db, customerId);
    const driver = {
      key: "mock",
      request: async () => ({ ok: false as const, error: "n/a" }),
      verify: async () => ({ ok: false as const, error: "n/a" }),
      refund: async () => ({ ok: false as const, error: "gateway down" }),
    } as unknown as PaymentDriver;
    const row = await refund(handle.db, order.id, order.grandTotal, "خرابی درگاه", actor, "gateway", { drivers: { payment: () => driver }, settings: SETTINGS });
    expect(row.status).toBe("failed");
    expect((await findById(handle.db, order.id))?.status).toBe("paid");
    expect(await loyalty.balance(handle.db, customerId)).toBe(before);
    const sms = (await handle.db.select().from(jobsTable)).filter((j) => j.uniqueKey === `sms:refund:${row.id}`);
    expect(sms).toHaveLength(0);
    // a failed attempt does not consume the refundable amount
    expect(refundable(order, 0)).toBe(order.grandTotal);
    await expect(refund(handle.db, order.id, order.grandTotal, "بدون درایور", actor, "gateway", { settings: SETTINGS })).rejects.toThrow();
  });
});
