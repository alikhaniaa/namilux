import { type Db, and, customers, desc, eq, loyaltyLedger as ledgerTable, lt, sql } from "@namilux/db";
import { appError } from "../errors";
import { audit } from "../audit";
import type { Actor, LoyaltyLedgerEntry, Order, Paged } from "../types";
import type { LoyaltyReason } from "../constants";
import type { LoyaltyRules } from "./rules";

/** Pure: how many points the shopper may redeem on this order and what that is worth.
 *  Not re-exported - the public `redeemValue` lives in ../pricing; this is the loyalty object's copy. */
function redeemValue(balance: number, subtotal: number, rules: LoyaltyRules): { points: number; value: number } {
  if (!rules.enabled || balance <= 0 || subtotal <= 0) return { points: 0, value: 0 };
  const cap = Math.floor((subtotal * rules.maxRedeemPercent) / 100);
  const value = Math.min(balance * rules.pointValueToman, cap);
  const points = Math.floor(value / rules.pointValueToman);
  const finalValue = points * rules.pointValueToman;
  if (finalValue < rules.minRedeem) return { points: 0, value: 0 };
  return { points, value: finalValue };
}

async function sumBalance(db: Db, customerId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`coalesce(sum(${ledgerTable.delta}), 0)::int` }).from(ledgerTable).where(eq(ledgerTable.customerId, customerId));
  return Number(row?.n ?? 0);
}

async function syncBalance(db: Db, customerId: string): Promise<number> {
  // Explicit repair only. Normal inserts use nl_apply_loyalty_delta, whose atomic increment
  // preserves concurrent writes without an extra application-level cache overwrite.
  const balance = await sumBalance(db, customerId);
  await db.update(customers).set({ pointsBalance: balance }).where(eq(customers.id, customerId));
  return balance;
}

/** Ledger writes and the cached balance share one customer lock, including across orders. */
async function withCustomerLock<T>(db: Db, customerId: string, work: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).for("update");
    return work(tx);
  });
}

async function outstandingRedemption(db: Db, orderId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`coalesce(sum(${ledgerTable.delta}), 0)::int` }).from(ledgerTable)
    .where(and(eq(ledgerTable.orderId, orderId), sql`(${ledgerTable.reason} = 'redeem' or (${ledgerTable.reason} = 'adjust' and ${ledgerTable.note} = 'redeem release'))`));
  return Math.max(0, -Number(row?.n ?? 0));
}

/** Cumulative rounding makes split refunds equivalent to a single refund of the same amount. */
async function reverseEarnedForRefund(db: Db, order: Order, refundedTotal: number, actor: Actor): Promise<void> {
  const customerId = order.customerId;
  if (customerId === null) return;
  await withCustomerLock(db, customerId, async (tx) => {
    const [earn] = await tx.select({ n: sql<number>`coalesce(sum(${ledgerTable.delta}), 0)::int` }).from(ledgerTable)
      .where(and(eq(ledgerTable.orderId, order.id), eq(ledgerTable.reason, "earn")));
    const points = Number(earn?.n ?? 0);
    if (points <= 0 || refundedTotal <= 0) return;
    const target = refundedTotal >= order.grandTotal ? points : Math.round(points * refundedTotal / order.grandTotal);
    // Older partial refunds used adjust() without orderId. Its exact generated note identifies
    // those debits, so finishing an existing refund does not charge the earned points twice.
    const [previous] = await tx.select({ n: sql<number>`coalesce(sum(-${ledgerTable.delta}), 0)::int` }).from(ledgerTable)
      .where(and(eq(ledgerTable.customerId, customerId), eq(ledgerTable.reason, "adjust"), lt(ledgerTable.delta, 0),
        sql`((${ledgerTable.orderId} = ${order.id} and ${ledgerTable.note} = 'refund reversal')
          or (${ledgerTable.orderId} is null and ${ledgerTable.note} = ${`بازپرداخت جزئی ${order.code}`}))`));
    const remaining = target - Number(previous?.n ?? 0);
    if (remaining <= 0) return;
    await tx.insert(ledgerTable).values({ customerId, delta: -remaining, reason: "adjust", orderId: order.id, expiresAt: null, note: "refund reversal" });
    await audit.log(tx, actor, "loyalty.reverse", "customers", customerId, null, { orderId: order.id, points: -remaining, refundedTotal });
  });
}

async function hasRow(db: Db, orderId: string, reason: LoyaltyReason): Promise<boolean> {
  const rows = await db.select({ id: ledgerTable.id }).from(ledgerTable).where(and(eq(ledgerTable.orderId, orderId), eq(ledgerTable.reason, reason))).limit(1);
  return rows[0] !== undefined;
}

function mapEntry(r: typeof ledgerTable.$inferSelect): LoyaltyLedgerEntry {
  return {
    id: r.id,
    customerId: r.customerId,
    delta: r.delta,
    reason: r.reason,
    orderId: r.orderId,
    expiresAt: r.expiresAt === null ? null : r.expiresAt.toISOString(),
    note: r.note,
    createdAt: r.createdAt.toISOString(),
  };
}

export const loyalty = {
  redeemValue,

  async earnForOrder(db: Db, order: Order, rules: LoyaltyRules): Promise<number> {
    if (!rules.enabled || order.customerId === null) return 0;
    const customerId = order.customerId;
    return withCustomerLock(db, customerId, async (tx) => {
      if (await hasRow(tx, order.id, "earn")) return 0; // idempotent (callback replay)
      const points = Math.floor(order.grandTotal / rules.earnPerToman);
      if (points <= 0) return 0;
      const paidAt = order.paidAt === null ? new Date() : new Date(order.paidAt);
      const expiresAt = new Date(paidAt);
      expiresAt.setMonth(expiresAt.getMonth() + rules.expiryMonths);
      await tx.insert(ledgerTable).values({ customerId, delta: points, reason: "earn", orderId: order.id, expiresAt, note: null });
      return points;
    });
  },

  async reverseForOrder(db: Db, order: Order, actor: Actor): Promise<void> {
    await reverseEarnedForRefund(db, order, order.grandTotal, actor);
  },

  async reverseForRefund(db: Db, order: Order, refundedTotal: number, actor: Actor): Promise<void> {
    await reverseEarnedForRefund(db, order, refundedTotal, actor);
  },

  async redeemForOrder(db: Db, customerId: string, orderId: string, points: number): Promise<void> {
    if (points <= 0) return;
    await withCustomerLock(db, customerId, async (tx) => {
      // A retry after failure/expiry needs a new debit; a replay while it is still held does not.
      const needed = points - await outstandingRedemption(tx, orderId);
      if (needed <= 0) return;
      const balance = await sumBalance(tx, customerId);
      if (needed > balance) throw appError("VALIDATION", { fa: "امتیاز کافی نیست" });
      await tx.insert(ledgerTable).values({ customerId, delta: -needed, reason: "redeem", orderId, expiresAt: null, note: null });
    });
  },

  async releaseRedeem(db: Db, orderId: string): Promise<void> {
    const redeem = await db.select({ customerId: ledgerTable.customerId, delta: ledgerTable.delta }).from(ledgerTable).where(and(eq(ledgerTable.orderId, orderId), eq(ledgerTable.reason, "redeem"))).limit(1);
    const row = redeem[0];
    if (row === undefined) return;
    await withCustomerLock(db, row.customerId, async (tx) => {
      const outstanding = await outstandingRedemption(tx, orderId);
      if (outstanding === 0) return;
      await tx.insert(ledgerTable).values({ customerId: row.customerId, delta: outstanding, reason: "adjust", orderId, expiresAt: null, note: "redeem release" });
    });
  },

  async adjust(db: Db, customerId: string, delta: number, note: string, actor: Actor): Promise<void> {
    if (delta === 0) return;
    await withCustomerLock(db, customerId, async (tx) => {
      await tx.insert(ledgerTable).values({ customerId, delta, reason: "adjust", orderId: null, expiresAt: null, note });
      const balance = await sumBalance(tx, customerId);
      await audit.log(tx, actor, "loyalty.adjust", "customers", customerId, null, { delta, note, balance });
    });
  },

  async award(db: Db, customerId: string, reason: LoyaltyReason, points: number, note?: string): Promise<void> {
    if (points <= 0) return;
    await withCustomerLock(db, customerId, async (tx) => {
      await tx.insert(ledgerTable).values({ customerId, delta: points, reason, orderId: null, expiresAt: null, note: note ?? null });
    });
  },

  async balance(db: Db, customerId: string): Promise<number> {
    return sumBalance(db, customerId);
  },

  async recomputeBalance(db: Db, customerId: string): Promise<number> {
    return withCustomerLock(db, customerId, (tx) => syncBalance(tx, customerId));
  },

  async history(db: Db, customerId: string, page = 1): Promise<Paged<LoyaltyLedgerEntry>> {
    const pageSize = 50;
    const rows = await db.select().from(ledgerTable).where(eq(ledgerTable.customerId, customerId)).orderBy(desc(ledgerTable.id)).limit(pageSize).offset((Math.max(1, page) - 1) * pageSize);
    return { items: rows.map(mapEntry), total: rows.length, page: Math.max(1, page), pageSize };
  },

  async expire(db: Db, now: Date, rules: LoyaltyRules): Promise<{ customers: number; points: number }> {
    if (!rules.enabled) return { customers: 0, points: 0 };
    // Customers with earn rows past their expiry that have not yet been expired.
    const due = await db
      .select({ customerId: ledgerTable.customerId, expired: sql<number>`coalesce(sum(${ledgerTable.delta}), 0)::int` })
      .from(ledgerTable)
      .where(and(eq(ledgerTable.reason, "earn"), lt(ledgerTable.expiresAt, now)))
      .groupBy(ledgerTable.customerId);
    let customersAffected = 0;
    let totalPoints = 0;
    for (const d of due) {
      const toExpire = await withCustomerLock(db, d.customerId, async (tx) => {
        const alreadyExpired = await tx.select({ n: sql<number>`coalesce(sum(-${ledgerTable.delta}), 0)::int` }).from(ledgerTable).where(and(eq(ledgerTable.customerId, d.customerId), eq(ledgerTable.reason, "expire")));
        const balance = await sumBalance(tx, d.customerId);
        const remaining = Math.min(Math.max(0, d.expired - Number(alreadyExpired[0]?.n ?? 0)), Math.max(0, balance));
        if (remaining <= 0) return 0;
        await tx.insert(ledgerTable).values({ customerId: d.customerId, delta: -remaining, reason: "expire", orderId: null, expiresAt: null, note: null });
        return remaining;
      });
      if (toExpire === 0) continue;
      customersAffected += 1;
      totalPoints += toExpire;
    }
    return { customers: customersAffected, points: totalPoints };
  },
};
