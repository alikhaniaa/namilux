import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, seedMinimal, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { eq, inventoryReservations, orderEvents, orders } from "@namilux/db";
import { SETTINGS, paidOrder, pendingOrder, staffActor } from "../../__tests__/support/fixtures";
import type { Actor } from "../../types";
import { cancelByCustomer, getOrderForCustomer, listOrdersForCustomer, requestReturn, trackOrder, trackingUrl } from "../tracking";

describe("customer order views - pure", () => {
  it("tracking url per carrier", () => {
    expect(trackingUrl("post", "RB123456789IR")).toBe("https://tracking.post.ir/?id=RB123456789IR");
    expect(trackingUrl("tipax", "T-1")).toBe("https://tipaxco.com/tracking/T-1");
    expect(trackingUrl("courier", "X")).toBeNull();
    expect(trackingUrl("pickup", "X")).toBeNull();
    expect(trackingUrl("other", "X")).toBeNull();
    expect(trackingUrl("post", null)).toBeNull();
  });
});

describe.skipIf(!hasTestDb())("customer order views — integration", () => {
  let handle: TestDb;
  let actor: Actor;
  let productId: number;
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

  async function seed(): Promise<void> {
    const s = await seedMinimal(handle.db);
    productId = s.productId;
    customerId = s.customerId;
    actor = await staffActor(handle.db);
  }

  it("trackOrder returns null for a wrong phone", async () => {
    await seed();
    const order = await paidOrder(handle.db, { productId, customerId }, actor);
    expect(await trackOrder(handle.db, order.code, "09129999999")).toBeNull();
    expect(await trackOrder(handle.db, "NL-NOPE1", order.phone)).toBeNull();
    const view = await trackOrder(handle.db, order.code, order.phone);
    expect(view?.code).toBe(order.code);
    expect(view?.status).toBe("paid");
  });

  it("cancel of a pending order releases reservations", async () => {
    await seed();
    const order = await pendingOrder(handle.db, { productId, customerId }, actor);
    const before = await handle.db.select().from(inventoryReservations).where(eq(inventoryReservations.orderId, order.id));
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((r) => r.releasedAt === null)).toBe(true);
    const cancelled = await cancelByCustomer(handle.db, order.code, customerId, "پشیمان شدم", { settings: SETTINGS });
    expect(cancelled.status).toBe("cancelled");
    const after = await handle.db.select().from(inventoryReservations).where(eq(inventoryReservations.orderId, order.id));
    expect(after.every((r) => r.releasedAt !== null)).toBe(true);
    // another customer cannot cancel it
    await expect(cancelByCustomer(handle.db, order.code, "01ARZ3NDEKTSV4RRFFQ69G5FAV", "x", { settings: SETTINGS })).rejects.toThrow();
  });

  it("cancel of a paid order creates a refund request event", async () => {
    await seed();
    const order = await paidOrder(handle.db, { productId, customerId }, actor);
    const cancelled = await cancelByCustomer(handle.db, order.code, customerId, "منصرف شدم", { settings: SETTINGS });
    expect(cancelled.status).toBe("cancelled");
    const events = await handle.db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id));
    expect(events.some((e) => e.type === "refund.requested")).toBe(true);
  });

  it("return request outside 7 days is rejected", async () => {
    await seed();
    const order = await paidOrder(handle.db, { productId, customerId }, actor);
    const input = { orderCode: order.code, reason: "کالا خراب به دستم رسید و کار نمی‌کند" };
    // not delivered yet → not returnable
    await expect(requestReturn(handle.db, order.code, customerId, input)).rejects.toThrow();
    await handle.db.update(orders).set({ status: "delivered", deliveredAt: new Date(Date.now() - 10 * 86_400_000) }).where(eq(orders.id, order.id));
    await expect(requestReturn(handle.db, order.code, customerId, input)).rejects.toThrow(/مهلت/);
    await handle.db.update(orders).set({ deliveredAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(orders.id, order.id));
    const res = await requestReturn(handle.db, order.code, customerId, input);
    expect(res.id).toMatch(/^[0-9A-Z]{26}$/);
    // a second request for the same order is refused
    await expect(requestReturn(handle.db, order.code, customerId, input)).rejects.toThrow();
  });

  it("customer view has no admin fields", async () => {
    await seed();
    const order = await paidOrder(handle.db, { productId, customerId }, actor);
    await handle.db.update(orders).set({ adminNote: "PRIVATE staff note" }).where(eq(orders.id, order.id));
    await handle.db.insert(orderEvents).values({ orderId: order.id, type: "note", payloadJson: { note: "PRIVATE event note" }, actorType: "staff", actorId: actor.id });
    const track = await trackOrder(handle.db, order.code, order.phone);
    expect(track).not.toBeNull();
    expect(track === null ? [] : Object.keys(track)).not.toEqual(expect.arrayContaining(["address", "adminNote", "customerId", "email", "couponCode"]));
    expect("adminNote" in (track ?? {})).toBe(false);
    expect("address" in (track ?? {})).toBe(false);
    expect(track?.phoneMasked).toMatch(/\*/);
    const mine = await getOrderForCustomer(handle.db, order.code, customerId);
    expect(mine?.items).toHaveLength(1);
    expect(typeof mine?.canCancel).toBe("boolean");
    expect(mine).not.toHaveProperty("adminNote");
    expect(mine).not.toHaveProperty("events");
    expect(JSON.stringify(mine)).not.toContain("PRIVATE");
    expect(JSON.stringify(track)).not.toContain("PRIVATE");
    expect(await getOrderForCustomer(handle.db, order.code, "01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBeNull();
  });

  it("unified storefront reads historical channels while explicit scopes remain available", async () => {
    await seed();
    const order = await paidOrder(handle.db, { productId, customerId }, actor);
    await handle.db.update(orders).set({ channel: "instalments" }).where(eq(orders.id, order.id));
    expect(await getOrderForCustomer(handle.db, order.code, customerId, "main")).toBeNull();
    expect((await getOrderForCustomer(handle.db, order.code, customerId, "instalments"))?.code).toBe(order.code);
    expect(await trackOrder(handle.db, order.code, order.phone, "main")).toBeNull();
    expect((await trackOrder(handle.db, order.code, order.phone, "instalments"))?.code).toBe(order.code);
    expect((await listOrdersForCustomer(handle.db, customerId, 1, "main")).total).toBe(0);
    expect((await listOrdersForCustomer(handle.db, customerId, 1, "instalments")).items.map((o) => o.code)).toEqual([order.code]);
    // The unified customer storefront omits channel but still requires ownership/code+phone.
    expect((await getOrderForCustomer(handle.db, order.code, customerId))?.code).toBe(order.code);
    expect((await trackOrder(handle.db, order.code, order.phone))?.code).toBe(order.code);
    expect(await getOrderForCustomer(handle.db, order.code, "01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBeNull();
    expect((await listOrdersForCustomer(handle.db, customerId, 1)).total).toBe(1);
    await expect(requestReturn(handle.db, order.code, customerId, { orderCode: order.code, reason: "کالا خراب به دستم رسید و کار نمی‌کند" }, "main")).rejects.toThrow(/پیدا نشد/);
    await expect(cancelByCustomer(handle.db, order.code, customerId, "x", { settings: SETTINGS, channel: "main" })).rejects.toThrow();
  });
});
