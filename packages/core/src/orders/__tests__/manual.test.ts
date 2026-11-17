import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, seedMinimal, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { auditLog, eq, inventoryReservations, jobs as jobsTable, orders, payments } from "@namilux/db";
import { ADDRESS, SETTINGS, SITE_ORIGIN, ensureShipping, staffActor } from "../../__tests__/support/fixtures";
import type { Actor } from "../../types";
import { createManualOrder, markPaidManually, submitManualOrder } from "../manual";
import { listStaleDrafts } from "../repo";
import { orderState } from "../state";

describe.skipIf(!hasTestDb())("manual orders", () => {
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
    await ensureShipping(handle.db);
  }

  function input(over: Partial<Parameters<typeof createManualOrder>[1]> = {}): Parameters<typeof createManualOrder>[1] {
    return {
      customerId,
      phone: "09121234567",
      items: [{ productId, qty: 1 }],
      shippingMethodKey: "free_nationwide",
      address: ADDRESS,
      source: "instagram",
      channelRef: "@namilux",
      settle: { kind: "payment_link" },
      ...over,
    };
  }

  it("draft creates no reservations", async () => {
    await seed();
    const draft = await createManualOrder(handle.db, input(), actor, { settings: SETTINGS });
    expect(draft.status).toBe("draft");
    expect(draft.source).toBe("instagram");
    expect(draft.items).toHaveLength(1);
    expect(draft.grandTotal).toBe(41_500_000);
    expect(await handle.db.select().from(inventoryReservations).where(eq(inventoryReservations.orderId, draft.id))).toHaveLength(0);
  });

  it("payment_link mode reserves stock and sends the pay url by sms", async () => {
    await seed();
    const draft = await createManualOrder(handle.db, input(), actor, { settings: SETTINGS });
    const pending = await submitManualOrder(handle.db, draft.id, "payment_link", actor, { settings: SETTINGS, env: { SITE_ORIGIN } });
    expect(pending.status).toBe("pending_payment");
    const reservations = await handle.db.select().from(inventoryReservations).where(eq(inventoryReservations.orderId, draft.id));
    expect(reservations.length).toBeGreaterThan(0);
    const sms = (await handle.db.select().from(jobsTable)).filter((j) => j.type === "sms.send" && JSON.stringify(j.payloadJson).includes(`/pay/${pending.code}/`));
    expect(sms).toHaveLength(1);
    expect(JSON.stringify(sms[0]?.payloadJson)).toContain(SITE_ORIGIN);
  });

  it("mark_paid requires sudo and records a manual payment row", async () => {
    await seed();
    // sudo is asserted by the admin route (assertFreshSudo) before core is reached; core records the payment.
    const draft = await createManualOrder(handle.db, input(), actor, { settings: SETTINGS });
    await expect(markPaidManually(handle.db, draft.id, { method: "cash", reference: "نقدی ۱" }, actor, { settings: SETTINGS })).rejects.toThrow(); // a draft is not awaiting payment
    const pending = await submitManualOrder(handle.db, draft.id, "payment_link", actor, { settings: SETTINGS, env: { SITE_ORIGIN } });
    const paid = await markPaidManually(handle.db, pending.id, { method: "pos", reference: "POS-771" }, actor, { settings: SETTINGS });
    expect(paid.status).toBe("paid");
    expect(paid.paidAt).not.toBeNull();
    expect(paid.invoiceNo).not.toBeNull();
    const rows = await handle.db.select().from(payments).where(eq(payments.orderId, pending.id));
    const manual = rows.find((p) => p.driver === "manual");
    expect(manual?.status).toBe("succeeded");
    expect(manual?.refId).toBe("POS-771");
    expect(manual?.amount).toBe(paid.grandTotal);
    const audit = (await handle.db.select().from(auditLog)).filter((a) => a.entityId === pending.id && a.action === "order.manual_paid");
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.afterJson)).toContain("pos");
  });

  it("price override is audited with reason", async () => {
    await seed();
    const draft = await createManualOrder(
      handle.db,
      input({ items: [{ productId, qty: 1, unitPriceOverride: 39_000_000, overrideReason: "تخفیف توافقی تلفنی" }] }),
      actor,
      { settings: SETTINGS },
    );
    expect(draft.items[0]?.unitPrice).toBe(39_000_000);
    expect(draft.grandTotal).toBe(39_000_000);
    const audit = (await handle.db.select().from(auditLog)).filter((a) => a.entityId === draft.id);
    expect(JSON.stringify(audit)).toContain("تخفیف توافقی تلفنی");
  });

  it("stale drafts are cancelled after 7 days", async () => {
    await seed();
    const old = await createManualOrder(handle.db, input(), actor, { settings: SETTINGS });
    const young = await createManualOrder(handle.db, input(), actor, { settings: SETTINGS });
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);
    await handle.db.update(orders).set({ createdAt: eightDaysAgo, placedAt: eightDaysAgo }).where(eq(orders.id, old.id));
    const stale = await listStaleDrafts(handle.db, new Date(Date.now() - 7 * 86_400_000));
    expect(stale.map((o) => o.id)).toEqual([old.id]);
    // the worker (order-expire) cancels what it lists; the transition itself is valid for a draft
    const cancelled = await orderState.transition(handle.db, old.id, "cancelled", { actor: { type: "system", id: null }, reason: "stale draft", settings: SETTINGS });
    expect(cancelled.status).toBe("cancelled");
    expect((await listStaleDrafts(handle.db, new Date(Date.now() - 7 * 86_400_000))).map((o) => o.id)).toEqual([]);
    expect(young.status).toBe("draft");
  });
});
