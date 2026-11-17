import { type Db, and, cartItems, carts, eq, inArray, products, sql } from "@namilux/db";
import type { SalesChannel } from "../channel";
import { MAX_CART_LINES, MAX_QTY_PER_LINE } from "../constants";
import { ulid } from "../ids";
import type { CartLine } from "../types";

/**
 * DECISION: `channel` is a DEFAULTED last parameter on every entry point rather than a required one.
 * The two storefronts price the same product differently, so a basket belongs to one site
 * (carts_customer_channel_uq) - but the main site is the overwhelming majority of callers and the
 * default keeps every one of them, and the storefront that has not been split yet, correct.
 */

function iso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

export function normalizeLines(lines: CartLine[]): CartLine[] {
  const byId = new Map<number, CartLine>();
  for (const l of lines) {
    if (!Number.isInteger(l.id) || l.qty <= 0) continue;
    const prev = byId.get(l.id);
    if (prev === undefined) {
      byId.set(l.id, { id: l.id, qty: l.qty, addedAt: l.addedAt });
    } else {
      byId.set(l.id, {
        id: l.id,
        qty: prev.qty + l.qty,
        addedAt: prev.addedAt < l.addedAt ? prev.addedAt : l.addedAt,
      });
    }
  }
  return [...byId.values()].sort((a, b) => (a.addedAt < b.addedAt ? -1 : a.addedAt > b.addedAt ? 1 : 0));
}

/** Cap per-line qty and the number of lines; drop products that no longer exist or are not active. */
async function sanitize(db: Db, lines: CartLine[]): Promise<CartLine[]> {
  const capped = normalizeLines(
    lines.map((l) => ({ id: l.id, qty: Math.min(l.qty, MAX_QTY_PER_LINE), addedAt: l.addedAt })),
  ).slice(0, MAX_CART_LINES);
  if (capped.length === 0) return [];
  const ids = capped.map((l) => l.id);
  const live = await db
    .select({ id: products.id })
    .from(products)
    // Off sale = gone: archived, draft, hidden, or «استعلامی» (price 0). Out of stock stays.
    .where(and(inArray(products.id, ids), eq(products.status, "active"), sql`${products.visibility} <> 'hidden'`, sql`${products.price} > 0`));
  const liveSet = new Set(live.map((r) => r.id));
  return capped.filter((l) => liveSet.has(l.id));
}

async function getCartRow(db: Db, customerId: string, channel: SalesChannel): Promise<{ id: string; updatedAt: Date } | null> {
  const rows = await db
    .select({ id: carts.id, updatedAt: carts.updatedAt })
    .from(carts)
    .where(and(eq(carts.customerId, customerId), eq(carts.channel, channel)))
    .limit(1);
  return rows[0] ?? null;
}

async function ensureCartRow(db: Db, customerId: string, channel: SalesChannel): Promise<string> {
  const existing = await getCartRow(db, customerId, channel);
  if (existing !== null) return existing.id;
  const id = ulid();
  const inserted = await db
    .insert(carts)
    .values({ id, customerId, channel })
    .onConflictDoNothing({ target: [carts.customerId, carts.channel] })
    .returning({ id: carts.id });
  if (inserted[0] !== undefined) return inserted[0].id;
  const again = await getCartRow(db, customerId, channel);
  if (again === null) throw new Error("cart row vanished after upsert");
  return again.id;
}

async function readLines(db: Db, cartId: string): Promise<CartLine[]> {
  const items = await db
    .select({ productId: cartItems.productId, qty: cartItems.qty, addedAt: cartItems.addedAt })
    .from(cartItems)
    .where(eq(cartItems.cartId, cartId));
  return normalizeLines(items.map((i) => ({ id: i.productId, qty: i.qty, addedAt: iso(i.addedAt) })));
}

async function writeLines(db: Db, cartId: string, lines: CartLine[], updatedAt: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.select({ id: carts.id }).from(carts).where(eq(carts.id, cartId)).for("update");
    await tx.delete(cartItems).where(eq(cartItems.cartId, cartId));
    if (lines.length > 0) {
      await tx.insert(cartItems).values(
        lines.map((l) => ({ cartId, productId: l.id, qty: l.qty, addedAt: new Date(l.addedAt) })),
      );
    }
    await tx.update(carts).set({ updatedAt }).where(eq(carts.id, cartId));
  });
}

export const cart = {
  async get(db: Db, customerId: string, channel: SalesChannel = "main"): Promise<{ lines: CartLine[]; updatedAt: string | null }> {
    const row = await getCartRow(db, customerId, channel);
    if (row === null) return { lines: [], updatedAt: null };
    return { lines: await readLines(db, row.id), updatedAt: iso(row.updatedAt) };
  },
  async replace(
    db: Db,
    customerId: string,
    lines: CartLine[],
    updatedAt: string,
    channel: SalesChannel = "main",
  ): Promise<{ lines: CartLine[]; updatedAt: string }> {
    const row = await getCartRow(db, customerId, channel);
    const incoming = new Date(updatedAt);
    if (row !== null && row.updatedAt.getTime() > incoming.getTime()) {
      // stored write is newer - ignore this one, hand back the current server state
      return { lines: await readLines(db, row.id), updatedAt: iso(row.updatedAt) };
    }
    const cartId = row?.id ?? (await ensureCartRow(db, customerId, channel));
    const clean = await sanitize(db, lines);
    await writeLines(db, cartId, clean, incoming);
    return { lines: clean, updatedAt: iso(incoming) };
  },
  async merge(db: Db, customerId: string, guestLines: CartLine[], channel: SalesChannel = "main"): Promise<CartLine[]> {
    const cartId = await ensureCartRow(db, customerId, channel);
    const server = await readLines(db, cartId);
    const merged = new Map<number, CartLine>();
    for (const l of [...server, ...guestLines]) {
      if (l.qty <= 0) continue;
      const prev = merged.get(l.id);
      if (prev === undefined) merged.set(l.id, { ...l });
      else
        merged.set(l.id, {
          id: l.id,
          // Both inputs are cart snapshots, not add-item commands. Replaying a
          // login/reload merge must never increase quantities.
          qty: Math.min(Math.max(prev.qty, l.qty), MAX_QTY_PER_LINE),
          addedAt: prev.addedAt < l.addedAt ? prev.addedAt : l.addedAt,
        });
    }
    const clean = await sanitize(db, [...merged.values()]);
    await writeLines(db, cartId, clean, new Date());
    return clean;
  },
  async clear(db: Db, customerId: string, channel: SalesChannel = "main"): Promise<void> {
    const row = await getCartRow(db, customerId, channel);
    if (row === null) return;
    await db.delete(cartItems).where(eq(cartItems.cartId, row.id));
    await db.update(carts).set({ updatedAt: sql`now()` }).where(eq(carts.id, row.id));
  },
};
