import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { eq, inventoryReservations, orders, payments, products, shippingMethods } from "@namilux/db";
import { ulid } from "../../ids";
import {
  activeReservedQty,
  applyStockDelta,
  insertMovement,
  insertReservation,
  listActiveShippingMethods,
  loadProductsForQuote,
  releaseExpired,
  stockDriftReport,
  sumMovements,
} from "../repo";

describe.skipIf(!hasTestDb())("inventory/repo — integration", () => {
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

  async function makeProduct(stockQty = 0): Promise<number> {
    const [p] = await handle.db
      .insert(products)
      .values({ slug: `repo-${ulid()}`, name: "n", displayName: "n", status: "active", visibility: "public", price: 1_000_000, stockQty })
      .returning({ id: products.id });
    return p!.id;
  }
  async function makeOrder(): Promise<string> {
    const id = ulid();
    await handle.db.insert(orders).values({ id, code: `NL-${ulid().slice(-5)}`, phone: "09121110000" });
    return id;
  }

  it("loadProductsForQuote returns products in the order of ids and omits unknown ids", async () => {
    const a = await makeProduct(3);
    const b = await makeProduct(5);
    const out = await loadProductsForQuote(handle.db, [b, 999_999, a], { lock: "none" });
    expect(out.map((p) => p.id)).toEqual([b, a]);
    expect(out[0]).toMatchObject({ id: b, stockQty: 5, reserved: 0, imageKey: null, categoryIds: [], collectionIds: [] });
    expect(out[0]).not.toHaveProperty("costPrice");
  });

  it("loadProductsForQuote reports active reserved qty", async () => {
    const id = await makeProduct(10);
    const order = await makeOrder();
    await insertReservation(handle.db, { id: ulid(), productId: id, orderId: order, qty: 2, expiresAt: new Date(Date.now() + 3_600_000) });
    const [p] = await loadProductsForQuote(handle.db, [id], { lock: "none" });
    expect(p!.reserved).toBe(2);
  });

  it("activeReservedQty counts expired holds until release, excluding released and consumed rows", async () => {
    const id = await makeProduct(10);
    const order = await makeOrder();
    const future = new Date(Date.now() + 3_600_000);
    const past = new Date(Date.now() - 3_600_000);
    const released = ulid();
    const consumed = ulid();
    await insertReservation(handle.db, { id: ulid(), productId: id, orderId: order, qty: 2, expiresAt: future }); // active
    await insertReservation(handle.db, { id: released, productId: id, orderId: order, qty: 3, expiresAt: future });
    await insertReservation(handle.db, { id: consumed, productId: id, orderId: order, qty: 4, expiresAt: future });
    await insertReservation(handle.db, { id: ulid(), productId: id, orderId: order, qty: 5, expiresAt: past }); // expired
    await handle.db.update(inventoryReservations).set({ releasedAt: new Date() }).where(eq(inventoryReservations.id, released));
    await handle.db.update(inventoryReservations).set({ consumedAt: new Date() }).where(eq(inventoryReservations.id, consumed));
    expect(await activeReservedQty(handle.db, id)).toBe(7);
  });

  it("releaseExpired skips a reservation with a fresh redirected payment and releases it once the grace passes", async () => {
    const id = await makeProduct(10);
    const order = await makeOrder();
    const now = new Date();
    await insertReservation(handle.db, { id: ulid(), productId: id, orderId: order, qty: 1, expiresAt: new Date(now.getTime() - 1000) });
    // a redirected payment created 5 minutes ago
    await handle.db.insert(payments).values({ id: ulid(), orderId: order, driver: "zarinpal", amount: 1_000_000, status: "redirected", createdAt: new Date(now.getTime() - 5 * 60_000) });
    const grace = 15 * 60_000;
    expect((await releaseExpired(handle.db, now, grace)).orderIds).toEqual([]); // within grace → skipped
    // 16 minutes later the payment is outside the grace window
    const later = new Date(now.getTime() + 16 * 60_000);
    expect((await releaseExpired(handle.db, later, grace)).orderIds).toEqual([order]);
  });

  it("releaseExpired returns each order id once even with several reservations", async () => {
    const id = await makeProduct(10);
    const order = await makeOrder();
    const past = new Date(Date.now() - 1000);
    await insertReservation(handle.db, { id: ulid(), productId: id, orderId: order, qty: 1, expiresAt: past });
    await insertReservation(handle.db, { id: ulid(), productId: id, orderId: order, qty: 1, expiresAt: past });
    const res = await releaseExpired(handle.db, new Date(), 0);
    expect(res.orderIds).toEqual([order]);
  });

  it("applyStockDelta on an unknown product throws NOT_FOUND", async () => {
    await expect(applyStockDelta(handle.db, 999_999, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("sumMovements on a product without movements → 0", async () => {
    const id = await makeProduct(0);
    expect(await sumMovements(handle.db, id)).toBe(0);
  });

  it("stockDriftReport lists only products whose stock_qty ≠ SUM(delta)", async () => {
    const consistent = await makeProduct(0);
    await insertMovement(handle.db, { productId: consistent, delta: 3, reason: "seed", actor: { type: "system", id: null } }); // trigger → stock 3, sum 3
    const drifted = await makeProduct(0);
    await insertMovement(handle.db, { productId: drifted, delta: 3, reason: "seed", actor: { type: "system", id: null } });
    await handle.db.update(products).set({ stockQty: 99 }).where(eq(products.id, drifted)); // corrupt
    const report = await stockDriftReport(handle.db);
    const ids = report.map((r) => r.productId);
    expect(ids).toContain(drifted);
    expect(ids).not.toContain(consistent);
  });

  it("listActiveShippingMethods maps rate_json and provinces into ShippingMethod", async () => {
    await handle.db.insert(shippingMethods).values({
      key: "free_nationwide",
      name: "ارسال رایگان",
      description: null,
      kind: "free",
      rateJson: { freeAbove: 0 },
      provinces: null,
      etaMinDays: 2,
      etaMaxDays: 7,
      isActive: true,
      sort: 0,
    });
    await handle.db.insert(shippingMethods).values({
      key: "express_tehran",
      name: "پیک تهران",
      kind: "flat",
      rateJson: { flat: 150_000 },
      provinces: ["THR"],
      etaMinDays: 0,
      etaMaxDays: 1,
      isActive: false,
      sort: 1,
    });
    const methods = await listActiveShippingMethods(handle.db);
    expect(methods.map((m) => m.key)).toEqual(["free_nationwide"]); // inactive omitted
    expect(methods[0]).toMatchObject({ kind: "free", description: "", provinces: null, etaMinDays: 2, etaMaxDays: 7 });
  });
});
