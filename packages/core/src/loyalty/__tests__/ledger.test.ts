import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, createTestDbAs, hasTestDb, seedMinimal, truncateAll } from "@namilux/db/test";
import type { TestDb } from "@namilux/db/test";
import { customers, eq, loyaltyLedger } from "@namilux/db";
import { paidOrder, staffActor } from "../../__tests__/support/fixtures";
import type { Actor, Order } from "../../types";
import { loyalty } from "../ledger";
import { DEFAULT_LOYALTY_RULES } from "../rules";

const RULES = DEFAULT_LOYALTY_RULES;

describe.skipIf(!hasTestDb())("loyalty ledger", () => {
  let handle: TestDb;
  let actor: Actor;
  let customerId: string;
  let order: Order;
  const EXPECTED = Math.floor(41_500_000 / RULES.earnPerToman); // the seed product's price → 4150 points

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
    // the paid transition may already have earned; either way exactly one earn row must exist afterwards
    await loyalty.earnForOrder(handle.db, order, RULES);
  }

  async function ledgerRows(): Promise<{ delta: number; reason: string; orderId: string | null }[]> {
    return handle.db.select({ delta: loyaltyLedger.delta, reason: loyaltyLedger.reason, orderId: loyaltyLedger.orderId }).from(loyaltyLedger).where(eq(loyaltyLedger.customerId, customerId));
  }

  it("earnForOrder is idempotent per order", async () => {
    await fresh();
    expect(await loyalty.earnForOrder(handle.db, order, RULES)).toBe(0);
    const earn = (await ledgerRows()).filter((r) => r.reason === "earn" && r.orderId === order.id);
    expect(earn).toHaveLength(1);
    expect(earn[0]?.delta).toBe(EXPECTED);
    expect(await loyalty.balance(handle.db, customerId)).toBe(EXPECTED);
  });

  it("redeem over balance is rejected", async () => {
    await fresh();
    await expect(loyalty.redeemForOrder(handle.db, customerId, order.id, EXPECTED + 1)).rejects.toThrow();
    expect(await loyalty.balance(handle.db, customerId)).toBe(EXPECTED);
  });

  it("releaseRedeem restores the balance once", async () => {
    await fresh();
    await loyalty.redeemForOrder(handle.db, customerId, order.id, 100);
    expect(await loyalty.balance(handle.db, customerId)).toBe(EXPECTED - 100);
    await loyalty.releaseRedeem(handle.db, order.id);
    expect(await loyalty.balance(handle.db, customerId)).toBe(EXPECTED);
    await loyalty.releaseRedeem(handle.db, order.id);
    expect(await loyalty.balance(handle.db, customerId)).toBe(EXPECTED);
  });

  it("a released redemption can be debited and released again without double charging", async () => {
    await fresh();
    await loyalty.redeemForOrder(handle.db, customerId, order.id, 100);
    await loyalty.redeemForOrder(handle.db, customerId, order.id, 100);
    expect(await loyalty.balance(handle.db, customerId)).toBe(EXPECTED - 100);
    await loyalty.releaseRedeem(handle.db, order.id);
    await loyalty.redeemForOrder(handle.db, customerId, order.id, 100);
    expect(await loyalty.balance(handle.db, customerId)).toBe(EXPECTED - 100);
    await loyalty.releaseRedeem(handle.db, order.id);
    await loyalty.releaseRedeem(handle.db, order.id);
    expect(await loyalty.balance(handle.db, customerId)).toBe(EXPECTED);
  });

  it("concurrent mutations keep the customer cache equal to the ledger", async () => {
    await fresh();
    await Promise.all([
      loyalty.adjust(handle.db, customerId, 125, "اصلاح", actor),
      loyalty.award(handle.db, customerId, "review", 50),
      loyalty.redeemForOrder(handle.db, customerId, order.id, 100),
    ]);
    const [cached] = await handle.db.select({ points: customers.pointsBalance }).from(customers).where(eq(customers.id, customerId));
    expect(await loyalty.balance(handle.db, customerId)).toBe(EXPECTED + 75);
    expect(cached?.points).toBe(EXPECTED + 75);
  });

  it("the web role can redeem and release points through the ledger trigger", async () => {
    await fresh();
    const web = await createTestDbAs("web");
    try {
      await loyalty.redeemForOrder(web.db, customerId, order.id, 100);
      const [held] = await web.db.select({ points: customers.pointsBalance }).from(customers).where(eq(customers.id, customerId));
      expect(held?.points).toBe(EXPECTED - 100);
      await loyalty.releaseRedeem(web.db, order.id);
      const [released] = await web.db.select({ points: customers.pointsBalance }).from(customers).where(eq(customers.id, customerId));
      expect(released?.points).toBe(EXPECTED);
    } finally {
      await web.close();
    }
  });

  it("concurrent redemptions cannot spend the same balance on two orders", async () => {
    await fresh();
    const seed = await seedMinimal(handle.db);
    const second = await paidOrder(handle.db, { productId: seed.productId, customerId }, actor);
    const balance = await loyalty.balance(handle.db, customerId);
    const results = await Promise.allSettled([
      loyalty.redeemForOrder(handle.db, customerId, order.id, balance),
      loyalty.redeemForOrder(handle.db, customerId, second.id, balance),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await loyalty.balance(handle.db, customerId)).toBe(0);
  });

  it("expire is FIFO and leaves redeemed points alone", async () => {
    await fresh();
    await loyalty.redeemForOrder(handle.db, customerId, order.id, 100);
    const later = new Date(order.paidAt ?? Date.now());
    later.setMonth(later.getMonth() + RULES.expiryMonths + 1);
    const res = await loyalty.expire(handle.db, later, RULES);
    expect(res.customers).toBe(1);
    expect(res.points).toBe(EXPECTED - 100);
    expect(await loyalty.balance(handle.db, customerId)).toBe(0);
    const rows = await ledgerRows();
    expect(rows.filter((r) => r.reason === "redeem")).toHaveLength(1); // the redeem row is untouched
    expect(rows.filter((r) => r.reason === "expire")).toHaveLength(1);
    // nothing left to expire on a rerun
    expect((await loyalty.expire(handle.db, later, RULES)).points).toBe(0);
  });

  it("reverseForOrder after refund mirrors the earn", async () => {
    await fresh();
    await loyalty.reverseForOrder(handle.db, order, actor);
    const rows = await ledgerRows();
    expect(rows.some((r) => r.delta === -EXPECTED && r.orderId === order.id)).toBe(true);
    expect(await loyalty.balance(handle.db, customerId)).toBe(0);
  });

  it("full reversal respects legacy partial refund debits and is idempotent", async () => {
    await fresh();
    await loyalty.adjust(handle.db, customerId, -100, `بازپرداخت جزئی ${order.code}`, actor);
    await loyalty.reverseForOrder(handle.db, order, actor);
    await loyalty.reverseForOrder(handle.db, order, actor);
    expect(await loyalty.balance(handle.db, customerId)).toBe(0);
  });

  it("a redemption release does not suppress earned-point reversal", async () => {
    await fresh();
    await loyalty.redeemForOrder(handle.db, customerId, order.id, 100);
    await loyalty.releaseRedeem(handle.db, order.id);
    await loyalty.reverseForOrder(handle.db, order, actor);
    expect(await loyalty.balance(handle.db, customerId)).toBe(0);
  });

  it("points_balance cache equals SUM(delta)", async () => {
    await fresh();
    await loyalty.adjust(handle.db, customerId, 250, "جبران", actor);
    await loyalty.award(handle.db, customerId, "review", 50);
    const rows = await ledgerRows();
    const sum = rows.reduce((acc, r) => acc + r.delta, 0);
    const cached = await handle.db.select({ points: customers.pointsBalance }).from(customers).where(eq(customers.id, customerId));
    expect(cached[0]?.points).toBe(sum);
    expect(await loyalty.recomputeBalance(handle.db, customerId)).toBe(sum);
    const history = await loyalty.history(handle.db, customerId);
    expect(history.total).toBe(rows.length);
  });
});
