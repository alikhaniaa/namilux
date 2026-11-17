import { type Db, and, eq, inArray, inventoryReservations, isNull, products, sql } from "@namilux/db";
import { audit } from "../audit";
import { tags } from "../cache/tags";
import type { MovementReason } from "../constants";
import { appError } from "../errors";
import { jobs } from "../jobs";
import { security } from "../security";
import type { Actor } from "../types";
import { activeReservedQty, insertMovement, lockProductForStock, stockDriftReport } from "./repo";

export const UNTRACKED_AVAILABLE = Number.MAX_SAFE_INTEGER;

export const ADJUST_REASONS: readonly MovementReason[] = ["restock", "adjust", "return", "cancel", "seed"];

const WRITE_ACTORS: readonly Actor["type"][] = ["staff", "system", "worker"];

/** Available for a locked/loaded product row: untracked is effectively infinite. */
function availableOfRow(stockPolicy: "track" | "untracked", stockQty: number, reserved: number): number {
  if (stockPolicy === "untracked") return UNTRACKED_AVAILABLE;
  return Math.max(stockQty - reserved, 0);
}

export async function availableStock(db: Db, productId: number): Promise<number> {
  const rows = await db
    .select({ stockPolicy: products.stockPolicy, stockQty: products.stockQty })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  const p = rows[0];
  if (p === undefined) throw appError("NOT_FOUND", { fa: "کالا پیدا نشد" });
  if (p.stockPolicy === "untracked") return UNTRACKED_AVAILABLE;
  const reserved = await activeReservedQty(db, productId);
  return Math.max(p.stockQty - reserved, 0);
}

export async function availableStockMany(db: Db, ids: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (ids.length === 0) return out;
  const [rows, reserved] = await Promise.all([
    db
      .select({ id: products.id, stockPolicy: products.stockPolicy, stockQty: products.stockQty })
      .from(products)
      .where(inArray(products.id, ids)),
    db
      .select({ productId: inventoryReservations.productId, qty: sql<number>`coalesce(sum(${inventoryReservations.qty}), 0)::int` })
      .from(inventoryReservations)
      .where(
        and(
          inArray(inventoryReservations.productId, ids),
          isNull(inventoryReservations.releasedAt),
          isNull(inventoryReservations.consumedAt),
        ),
      )
      .groupBy(inventoryReservations.productId),
  ]);
  const reservedOf = new Map(reserved.map((r) => [r.productId, r.qty]));
  for (const p of rows) {
    out.set(p.id, availableOfRow(p.stockPolicy, p.stockQty, reservedOf.get(p.id) ?? 0));
  }
  return out;
}

export async function adjustStock(
  db: Db,
  id: number,
  delta: number,
  reason: MovementReason,
  actor: Actor,
  orderId?: string,
  note?: string,
): Promise<{ stockQty: number }> {
  if (!Number.isInteger(delta) || delta === 0) throw appError("VALIDATION", { fa: "مقدار تغییر موجودی نامعتبر است" });
  if (!ADJUST_REASONS.includes(reason)) throw appError("VALIDATION", { fa: "دلیل نامعتبر است" });
  if (!WRITE_ACTORS.includes(actor.type)) throw appError("FORBIDDEN", { fa: "دسترسی مجاز نیست" });

  return db.transaction(async (tx) => {
    const p = await lockProductForStock(tx, id);
    if (p === null) throw appError("NOT_FOUND", { fa: "کالا پیدا نشد" });
    if (p.stockQty + delta < 0) throw appError("VALIDATION", { fa: "موجودی نمی‌تواند منفی شود" });

    const reserved = await activeReservedQty(tx, id);
    const before = availableOfRow(p.stockPolicy, p.stockQty, reserved);
    // The `apply_inventory_movement` trigger (0001_init.sql) maintains products.stock_qty from the
    // ledger - inserting the movement IS the stock change; writing stock_qty here would double-apply.
    const movement = await insertMovement(tx, { productId: id, delta, reason, orderId: orderId ?? null, actor, ...(note !== undefined ? { note } : {}) });
    const stockQty = p.stockQty + delta;
    const after = availableOfRow(p.stockPolicy, stockQty, reserved);
    await onAvailabilityChange(tx, id, before, after);

    if (actor.type === "staff") {
      await audit.log(tx, actor, "product.stock.adjust", "products", String(id), { stockQty: before }, { stockQty: after, delta, reason, note: note ?? null });
    }
    await jobs.enqueue(
      tx,
      "cache.revalidate",
      { tags: [tags.product(id), tags.catalog] },
      { uniqueKey: `revalidate:product:${id}:${movement.id}` },
    );
    return { stockQty };
  });
}

export async function onAvailabilityChange(db: Db, productId: number, before: number, after: number): Promise<void> {
  if (before <= 0 && after >= 1) {
    await jobs.enqueue(db, "stock.back_in_stock", { productId }, { uniqueKey: `bis:${productId}:${Date.now()}` });
  }
}

// DECISION (M0 step 3): `isLowStock` is exported once, by ../catalog/cards.ts. The two modules declared
// it with different parameters; cards.ts wins because this module's own WHAT disclaims the display
// concern ("does NOT render stock copy") and because src/client.ts - the decided client-safe surface
// - re-exports isLowStock from catalog/cards; sourcing it here would pull a @namilux/db module into
// the client barrel. The predicate is unchanged: 0 < available ≤ threshold.

export async function checkConsistency(
  db: Db,
): Promise<{ drift: { productId: number; stockQty: number; movementSum: number }[] }> {
  const drift = await stockDriftReport(db);
  if (drift.length > 0) await security.event(db, "stock.drift", { count: drift.length });
  return { drift };
}
