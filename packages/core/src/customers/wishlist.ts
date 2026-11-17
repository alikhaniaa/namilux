import { type Db, and, desc, eq, inArray, products, wishlists } from "@namilux/db";
import { MAX_WISHLIST_ITEMS } from "../constants";
import { getProductCards } from "../catalog";
import type { ProductCard } from "../types";

async function activeIds(db: Db, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await db.select({ id: products.id }).from(products).where(inArray(products.id, ids));
  return new Set(rows.map((r) => r.id));
}

export const wishlist = {
  async get(db: Db, customerId: string): Promise<number[]> {
    const rows = await db
      .select({ productId: wishlists.productId })
      .from(wishlists)
      .where(eq(wishlists.customerId, customerId))
      .orderBy(desc(wishlists.createdAt));
    return rows.map((r) => r.productId);
  },
  async replace(db: Db, customerId: string, ids: number[]): Promise<number[]> {
    // exact replace: keep the newest MAX_WISHLIST_ITEMS (ids arrive newest-first), drop unknown ids
    const deduped = [...new Set(ids)].slice(0, MAX_WISHLIST_ITEMS);
    const live = await activeIds(db, deduped);
    const keep = deduped.filter((id) => live.has(id));
    await db.transaction(async (tx) => {
      await tx.delete(wishlists).where(eq(wishlists.customerId, customerId));
      if (keep.length > 0) {
        // preserve newest-first ordering with a descending createdAt per index
        const base = Date.now();
        await tx.insert(wishlists).values(
          keep.map((id, idx) => ({ customerId, productId: id, createdAt: new Date(base - idx) })),
        );
      }
    });
    return keep;
  },
  async add(db: Db, customerId: string, productId: number): Promise<void> {
    const live = await activeIds(db, [productId]);
    if (!live.has(productId)) return;
    await db
      .insert(wishlists)
      .values({ customerId, productId })
      .onConflictDoNothing({ target: [wishlists.customerId, wishlists.productId] });
  },
  async remove(db: Db, customerId: string, productId: number): Promise<void> {
    await db
      .delete(wishlists)
      .where(and(eq(wishlists.customerId, customerId), eq(wishlists.productId, productId)));
  },
  async cards(db: Db, customerId: string): Promise<ProductCard[]> {
    const ids = await wishlist.get(db, customerId);
    if (ids.length === 0) return [];
    const cards = await getProductCards(db, ids);
    const byId = new Map(cards.map((c) => [c.id, c]));
    return ids.map((id) => byId.get(id)).filter((c): c is ProductCard => c !== undefined);
  },
};
