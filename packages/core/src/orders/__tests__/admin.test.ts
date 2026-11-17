import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, seedMinimal, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { eq, inventoryMovements, jobs as jobsTable } from "@namilux/db";
import { SETTINGS, paidOrder, staffActor } from "../../__tests__/support/fixtures";
import type { Actor, Order } from "../../types";
import { addNote, cancelByStaff, editItems, recordShipment, resendSms } from "../admin";
import { findById } from "../repo";
import { orderState } from "../state";

describe.skipIf(!hasTestDb())("admin order operations", () => {
  let handle: TestDb;
  let actor: Actor;
  let order: Order;
  let productId: number;

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
    productId = seed.productId;
    order = await paidOrder(handle.db, { productId, customerId: seed.customerId }, actor);
  }

  it("editItems is blocked after shipped", async () => {
    await fresh();
    const edited = await editItems(handle.db, order.id, { items: [{ productId, qty: 2 }] }, actor, { allowOverride: false });
    expect(edited.items[0]?.qty).toBe(2);
    expect(edited.subtotal).toBe(order.subtotal * 2);
    expect(edited.grandTotal).toBe(order.grandTotal * 2);
    // an override without the permission is refused; with it the unit price is taken as given
    await expect(editItems(handle.db, order.id, { items: [{ productId, qty: 1, unitPriceOverride: 1_000 }] }, actor, { allowOverride: false })).rejects.toThrow();
    const overridden = await editItems(handle.db, order.id, { items: [{ productId, qty: 1, unitPriceOverride: 1_000_000 }] }, actor, { allowOverride: true });
    expect(overridden.items[0]?.unitPrice).toBe(1_000_000);
    // the spec: paid → processing → shipped; items freeze once the order is being prepared
    await orderState.transition(handle.db, order.id, "processing", { actor, settings: SETTINGS });
    await expect(editItems(handle.db, order.id, { items: [{ productId, qty: 1 }] }, actor, { allowOverride: false })).rejects.toThrow();
    await recordShipment(handle.db, order.id, { carrier: "post", trackingCode: "RB123456789IR" }, actor, { settings: SETTINGS });
    await expect(editItems(handle.db, order.id, { items: [{ productId, qty: 1 }] }, actor, { allowOverride: false })).rejects.toThrow();
  });

  it("recordShipment transitions to shipped and enqueues the sms", async () => {
    await fresh();
    await orderState.transition(handle.db, order.id, "processing", { actor, settings: SETTINGS });
    const shipped = await recordShipment(handle.db, order.id, { carrier: "tipax", trackingCode: "T-77", cost: 150_000, note: "بسته‌بندی ویژه" }, actor, { settings: SETTINGS });
    expect(shipped.status).toBe("shipped");
    expect(shipped.shippedAt).not.toBeNull();
    const sms = (await handle.db.select().from(jobsTable)).filter((j) => j.type === "sms.send" && j.payloadJson["template"] === "order.shipped" && j.payloadJson["orderId"] === order.id);
    expect(sms).toHaveLength(1);
    // shipping twice is not a valid transition
    await expect(recordShipment(handle.db, order.id, { carrier: "post" }, actor, { settings: SETTINGS })).rejects.toThrow();
  });

  it("resendSms dedupes within a minute", async () => {
    await fresh();
    const count = async (): Promise<number> =>
      (await handle.db.select().from(jobsTable)).filter((j) => j.type === "sms.send" && j.payloadJson["template"] === "order.paid" && j.payloadJson["orderId"] === order.id).length;
    const before = await count();
    await resendSms(handle.db, order.id, "order.paid", actor);
    await resendSms(handle.db, order.id, "order.paid", actor);
    await resendSms(handle.db, order.id, "order.paid", actor);
    expect(await count()).toBe(before + 1);
    await addNote(handle.db, order.id, "مشتری تماس گرفت", actor);
    expect((await findById(handle.db, order.id))?.adminNote).toContain("مشتری تماس گرفت");
  });

  it("cancelByStaff with restock writes a cancel movement", async () => {
    await fresh();
    const cancelled = await cancelByStaff(handle.db, order.id, "اشتباه ثبت شده بود", true, actor, { settings: SETTINGS });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelReason).toBe("اشتباه ثبت شده بود");
    const moves = await handle.db.select().from(inventoryMovements).where(eq(inventoryMovements.orderId, order.id));
    const cancel = moves.filter((m) => m.reason === "cancel");
    expect(cancel).toHaveLength(1);
    expect(cancel[0]?.delta).toBe(order.items[0]?.qty ?? 1);
    expect(cancel[0]?.productId).toBe(productId);
  });
});
