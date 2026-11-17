import { type Db, and, asc, backInStockRequests, desc, eq, inArray, products, sql } from "@namilux/db";
import { ulid } from "../ids";
import { jobs } from "../jobs";
import { normalizePhone } from "../persian";
import { appError } from "../errors";
import type { BackInStockRequest, Paged } from "../types";

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

function mapRow(r: typeof backInStockRequests.$inferSelect): BackInStockRequest {
  return {
    id: r.id,
    productId: r.productId,
    phone: r.phone,
    customerId: r.customerId,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    notifiedAt: iso(r.notifiedAt),
  };
}

export const backInStock = {
  async request(db: Db, productId: number, phone: string, customerId?: string | null): Promise<{ created: boolean }> {
    const normalized = normalizePhone(phone);
    if (normalized === null) throw appError("VALIDATION", { fa: "شمارهٔ موبایل معتبر نیست" });
    const existing = await db
      .select({ id: backInStockRequests.id })
      .from(backInStockRequests)
      .where(and(eq(backInStockRequests.productId, productId), eq(backInStockRequests.phone, normalized), eq(backInStockRequests.status, "waiting")))
      .limit(1);
    if (existing[0] !== undefined) return { created: false };
    await db.insert(backInStockRequests).values({ id: ulid(), productId, phone: normalized, customerId: customerId ?? null });
    return { created: true };
  },
  async dueForProduct(db: Db, productId: number): Promise<{ id: string; phone: string }[]> {
    return db
      .select({ id: backInStockRequests.id, phone: backInStockRequests.phone })
      .from(backInStockRequests)
      .where(and(eq(backInStockRequests.productId, productId), eq(backInStockRequests.status, "waiting")))
      .orderBy(asc(backInStockRequests.createdAt))
      .limit(500);
  },
  async markNotified(db: Db, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await db.update(backInStockRequests).set({ status: "notified", notifiedAt: new Date() }).where(inArray(backInStockRequests.id, ids));
  },
  async cancel(db: Db, productId: number, phone: string): Promise<void> {
    const normalized = normalizePhone(phone);
    if (normalized === null) return;
    await db
      .update(backInStockRequests)
      .set({ status: "cancelled" })
      .where(and(eq(backInStockRequests.productId, productId), eq(backInStockRequests.phone, normalized), eq(backInStockRequests.status, "waiting")));
  },
  async listForCustomer(db: Db, customerId: string): Promise<BackInStockRequest[]> {
    const rows = await db
      .select()
      .from(backInStockRequests)
      .where(and(eq(backInStockRequests.customerId, customerId), eq(backInStockRequests.status, "waiting")))
      .orderBy(desc(backInStockRequests.createdAt));
    return rows.map(mapRow);
  },
  async demand(db: Db, q: { page?: number; minWaiting?: number }): Promise<Paged<{ productId: number; displayName: string; waiting: number; oldest: string }>> {
    const page = Math.max(1, q.page ?? 1);
    const pageSize = 50;
    const minWaiting = q.minWaiting ?? 1;
    const rows = await db
      .select({
        productId: backInStockRequests.productId,
        displayName: products.displayName,
        waiting: sql<number>`count(*)::int`,
        oldest: sql<string>`min(${backInStockRequests.createdAt})`,
      })
      .from(backInStockRequests)
      .innerJoin(products, eq(products.id, backInStockRequests.productId))
      .where(eq(backInStockRequests.status, "waiting"))
      .groupBy(backInStockRequests.productId, products.displayName)
      .having(sql`count(*) >= ${minWaiting}`)
      .orderBy(desc(sql`count(*)`))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { items: rows.map((r) => ({ ...r, oldest: new Date(r.oldest).toISOString() })), total: rows.length, page, pageSize };
  },
  async onAvailable(db: Db, productId: number): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    await jobs.enqueue(db, "stock.back_in_stock", { productId }, { uniqueKey: `bis:${productId}:${day}` });
  },
};
