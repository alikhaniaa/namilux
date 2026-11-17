import type { Db } from "@namilux/db";
import { appError } from "../errors";
import { ulid } from "../ids";
import type { Actor } from "../types";
import {
  activeReservedQty,
  insertMovement,
  insertReservation,
  listOrderReservations,
  lockProductForStock,
  markConsumed,
  markReleased,
  releaseExpired,
} from "./repo";
import type { PendingReservationExpiry, ProductStockRow } from "./repo";
import { onAvailabilityChange } from "./stock";

export const DEFAULT_PENDING_TTL_MIN = 30;
export const LATE_PAYMENT_GRACE_MS = 900_000;

export function checkReservable(
  p: ProductStockRow,
  reserved: number,
  qty: number,
): { ok: true } | { ok: false; available: number } {
  if (p.stockPolicy === "untracked" || p.allowBackorder) return { ok: true };
  const available = Math.max(p.stockQty - reserved, 0);
  return p.stockQty - reserved >= qty ? { ok: true } : { ok: false, available };
}

export async function reserve(
  db: Db,
  orderId: string,
  lines: { productId: number; qty: number }[],
  ttlMin: number,
): Promise<void> {
  if (lines.length === 0) return;
  if (ttlMin < 1) throw appError("VALIDATION", { fa: "مدت رزرو نامعتبر است" });
  const expiresAt = new Date(Date.now() + ttlMin * 60_000);
  // Sort by productId to acquire row locks in a consistent order (deadlock avoidance).
  const sorted = [...lines].sort((a, b) => a.productId - b.productId);
  for (const line of sorted) {
    if (!Number.isInteger(line.qty) || line.qty < 1) throw appError("VALIDATION", { fa: "تعداد نامعتبر است" });
    const p = await lockProductForStock(db, line.productId);
    if (p === null) throw appError("NOT_FOUND", { fa: "کالا پیدا نشد" });
    // The FOR UPDATE lock above serializes concurrent reservers on this product row, so the count
    // read here is consistent - the basis of "50 concurrent → exactly 3 succeed" (the spec §M3).
    const reserved = await activeReservedQty(db, line.productId);
    const check = checkReservable(p, reserved, line.qty);
    if (!check.ok) {
      throw appError("OUT_OF_STOCK", {
        httpStatus: 409,
        fa: "موجودی این کالا کافی نیست",
        details: { productId: line.productId, available: check.available },
      });
    }
    await insertReservation(db, { id: ulid(), productId: line.productId, orderId, qty: line.qty, expiresAt });
  }
}

export async function releaseReservations(db: Db, orderId: string): Promise<void> {
  await markReleased(db, orderId, new Date());
}

export async function consumeReservations(db: Db, orderId: string, actor: Actor): Promise<void> {
  const rows = await listOrderReservations(db, orderId, { lock: true });
  const now = new Date();
  for (const r of rows) {
    const p = await lockProductForStock(db, r.productId);
    if (p === null) throw appError("NOT_FOUND", { fa: "کالا پیدا نشد" });
    // A paid order wins over expiry, but stock is re-checked under the lock.
    if (p.stockPolicy === "track" && !p.allowBackorder && p.stockQty - r.qty < 0) {
      throw appError("OUT_OF_STOCK", { httpStatus: 409, fa: "موجودی برای پردازش این سفارش کافی نیست", details: { productId: r.productId } });
    }
    const before = p.stockPolicy === "untracked" ? Number.MAX_SAFE_INTEGER : Math.max(p.stockQty, 0);
    // The apply_inventory_movement trigger decrements products.stock_qty; do not write it here too.
    await insertMovement(db, { productId: r.productId, delta: -r.qty, reason: "sale", orderId, actor });
    await markConsumed(db, r.id, now);
    const after = p.stockPolicy === "untracked" ? Number.MAX_SAFE_INTEGER : Math.max(p.stockQty - r.qty, 0);
    await onAvailabilityChange(db, r.productId, before, after);
  }
}

export async function expireReservations(db: Db, now: Date, expirePending?: PendingReservationExpiry): Promise<{ orders: string[] }> {
  const { orderIds } = await releaseExpired(db, now, LATE_PAYMENT_GRACE_MS, expirePending);
  return { orders: orderIds };
}
