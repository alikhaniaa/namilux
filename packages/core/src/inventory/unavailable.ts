import { and, eq, inventoryReservations, isNull, products } from "@namilux/db";
import type { Db } from "@namilux/db";
import { audit } from "../audit";
import { tags } from "../cache/tags";
import { STOCK_NOTE_AVAILABLE, STOCK_NOTE_UNAVAILABLE, STOCK_RESTORE_MAX } from "../constants";
import { appError } from "../errors";
import { jobs } from "../jobs";
import type { Actor } from "../types";
import { activeReservedQty, insertMovement, lockProductForStock } from "./repo";
import { onAvailabilityChange } from "./stock";

const refreshTags = (id: number): string[] => [tags.product(id), tags.catalog, tags.home, tags.search, tags.sitemap];

/** One atomic stock action, using the ledger rather than overwriting stock_qty. */
export async function markProductUnavailable(db: Db, id: number, actor: Actor): Promise<void> {
  if (actor.type !== "staff") throw appError("FORBIDDEN");
  if (!Number.isSafeInteger(id) || id <= 0) throw appError("VALIDATION");
  await db.transaction(async (tx) => {
    const p = await lockProductForStock(tx, id);
    if (p === null) throw appError("NOT_FOUND");
    if (p.stockPolicy === "track" && p.stockQty === 0 && !p.allowBackorder) return;

    // Include expired but unreleased reservations: their payment may still return during grace.
    // reserve() takes the same product lock, so no new reservation can slip past this check.
    const held = await tx.select({ id: inventoryReservations.id }).from(inventoryReservations)
      .where(and(eq(inventoryReservations.productId, id), isNull(inventoryReservations.releasedAt), isNull(inventoryReservations.consumedAt)))
      .limit(1);
    if (held.length > 0) throw appError("CONFLICT", {
      fa: "این کالا در سفارش پرداخت‌نشده رزرو شده است؛ ابتدا وضعیت آن سفارش را مشخص کنید و سپس کالا را ناموجود کنید",
    });

    if (p.stockQty !== 0) await insertMovement(tx, {
      productId: id, delta: -p.stockQty, reason: "adjust", actor, note: STOCK_NOTE_UNAVAILABLE,
    });
    // updated_at is maintained by its trigger; the admin role cannot write it directly.
    await tx.update(products).set({ stockPolicy: "track", allowBackorder: false }).where(eq(products.id, id));
    await audit.log(tx, actor, "product.stock.unavailable", "products", String(id),
      { stockQty: p.stockQty, stockPolicy: p.stockPolicy, allowBackorder: p.allowBackorder },
      { stockQty: 0, stockPolicy: "track", allowBackorder: false });
    await jobs.enqueue(tx, "cache.revalidate", { tags: refreshTags(id) });
  });
}

/**
 * The way back from «ناموجود کردن»: puts `qty` into counted stock as a restock movement. A product
 * that can already be sold (stock above zero, preorder on, or uncounted) is left alone, which also
 * makes a second click a no-op once the product lock has serialized it behind the first.
 */
export async function markProductAvailable(db: Db, id: number, qty: number, actor: Actor): Promise<void> {
  if (actor.type !== "staff") throw appError("FORBIDDEN");
  if (!Number.isSafeInteger(id) || id <= 0) throw appError("VALIDATION");
  if (!Number.isInteger(qty) || qty < 1 || qty > STOCK_RESTORE_MAX) throw appError("VALIDATION", { fa: "تعداد موجودی نامعتبر است" });
  await db.transaction(async (tx) => {
    const p = await lockProductForStock(tx, id);
    if (p === null) throw appError("NOT_FOUND");
    if (p.stockPolicy !== "track" || p.allowBackorder || p.stockQty > 0) return;

    const reserved = await activeReservedQty(tx, id);
    await insertMovement(tx, { productId: id, delta: qty, reason: "restock", actor, note: STOCK_NOTE_AVAILABLE });
    // «خبرم کنید» subscribers hear about it exactly as after a restock entered in the price tab.
    await onAvailabilityChange(tx, id, 0, Math.max(qty - reserved, 0));
    await audit.log(tx, actor, "product.stock.available", "products", String(id), { stockQty: 0 }, { stockQty: qty });
    await jobs.enqueue(tx, "cache.revalidate", { tags: refreshTags(id) });
  });
}
