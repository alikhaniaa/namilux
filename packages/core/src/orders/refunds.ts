import type { Db } from "@namilux/db";
import type { Settings } from "../settings/schema";
import type { PaymentDriverKey } from "../constants";
import type { Actor, Order, OrderStatus, Refund } from "../types";
import { cartFor, type PaymentDriver } from "./payments";
import { appError } from "../errors";
import { audit } from "../audit";
import { jobs } from "../jobs";
import { loyalty } from "../loyalty/ledger";
import { findById, lockForUpdate, payments as paymentsRepo, refunds as refundsRepo } from "./repo";
import { orderEvents } from "./events";
import { orderState } from "./state";

/** A driver key with no configured driver (or one that throws) refunds nothing rather than crashing. */
function resolveDriver(drivers: { payment(key: PaymentDriverKey): PaymentDriver } | undefined, key: PaymentDriverKey): PaymentDriver | null {
  if (drivers === undefined) return null;
  try {
    return drivers.payment(key);
  } catch {
    return null;
  }
}

export function refundable(order: Order, totalRefunded: number): number {
  return Math.max(0, order.grandTotal - totalRefunded);
}

export async function listRefunds(db: Db, orderId: string): Promise<Refund[]> {
  return refundsRepo.listForOrder(db, orderId);
}

const REFUNDABLE_STATUSES = new Set<OrderStatus>(["paid", "processing", "shipped", "delivered", "returned"]);

export async function refund(
  db: Db,
  orderId: string,
  amount: number,
  reason: string,
  actor: Actor,
  via: "gateway" | "manual",
  ctx: { drivers?: { payment(key: PaymentDriverKey): PaymentDriver }; settings: Settings; restock?: boolean },
): Promise<Refund> {
  const order = await findById(db, orderId);
  if (order === null) throw appError("NOT_FOUND", { details: { orderId } });
  if (!REFUNDABLE_STATUSES.has(order.status)) throw appError("CONFLICT", { fa: "این سفارش قابل بازپرداخت نیست" });

  const already = await refundsRepo.totalRefunded(db, orderId);
  const max = refundable(order, already);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > max) {
    throw appError("VALIDATION", { fa: "مبلغ بازپرداخت نامعتبر است", details: { max } });
  }

  const succeeded = (await paymentsRepo.listForOrder(db, orderId)).find((p) => p.status === "succeeded");
  if (succeeded === undefined) throw appError("CONFLICT", { fa: "پرداخت موفقی برای این سفارش ثبت نشده است" });

  if (succeeded.driver === "snapppay" && via === "manual") {
    throw appError("VALIDATION", { fa: "بازپرداخت اسنپ‌پی باید از طریق خود درگاه انجام شود تا اقساط مشتری اصلاح شود" });
  }
  const driver = via === "gateway" ? resolveDriver(ctx.drivers, succeeded.driver) : null;
  let status: Refund["status"] = "done";
  let providerRef: string | null = via === "manual" ? reason : null;
  if (via === "gateway") {
    // The refund must go back through the gateway that TOOK the money, which is not necessarily the
    // one the environment currently defaults to - an order paid on SnappPay cannot be refunded
    // through ZarinPal, and once both are live the default changes under old orders.
    if (driver?.refund === undefined) throw appError("VALIDATION", { fa: "درگاه از بازپرداخت پشتیبانی نمی‌کند" });
    // Every gateway keys its refund on the reference it gave us at verify. The authority is NOT a
    // usable stand-in - ZarinPal's refund resolves a session from the ref_id, SnappPay's cancel takes
    // the paymentToken - so a payment without one is refused here rather than sent to be rejected.
    const refId = succeeded.refId ?? "";
    if (refId === "") throw appError("VALIDATION", { fa: "این پرداخت شناسهٔ مرجع ندارد" });
    // Honour full-only drivers. SnappPay supports both full cancel and partial cart update.
    const full = already + amount >= order.grandTotal;
    if (driver.refundsInFullOnly === true && !full) {
      throw appError("VALIDATION", { fa: "این درگاه فقط بازپرداخت کامل را می‌پذیرد" });
    }
  }
  const pending = await db.transaction(async (tx) => {
    const current = await lockForUpdate(tx, orderId);
    if (current === null || !REFUNDABLE_STATUSES.has(current.status)) throw appError("CONFLICT", { fa: "این سفارش قابل بازپرداخت نیست" });
    const previous = await refundsRepo.listForOrder(tx, orderId);
    if (previous.some((r) => r.status === "processing" || r.status === "requested") || await refundsRepo.totalRefunded(tx, orderId) !== already) {
      throw appError("CONFLICT", { fa: "یک بازپرداخت در حال بررسی است؛ ابتدا نتیجه آن را مشخص کنید" });
    }
    return refundsRepo.insert(tx, { paymentId: succeeded.id, orderId, amount, reason, status: "processing", providerRef: null, byStaffId: actor.id });
  });
  if (via === "gateway" && driver?.refund !== undefined && succeeded.refId !== null) {
    const res = await driver.refund({ refId: succeeded.refId, amount, reason, full: already + amount >= order.grandTotal, cart: cartFor(order), remainingAmount: max - amount }).catch(() => ({ ok: false, ref: undefined }));
    status = res.ok ? "done" : succeeded.driver === "snapppay" ? "processing" : "failed";
    providerRef = res.ref ?? null;
  }
  return db.transaction(async (tx) => {
    const current = await lockForUpdate(tx, orderId);
    if (current === null) throw appError("NOT_FOUND", { details: { orderId } });
    const doneAt = status === "done" ? new Date().toISOString() : pending.doneAt;
    await refundsRepo.update(tx, pending.id, { status, providerRef, ...(doneAt === null ? {} : { doneAt }) });
    const row = { ...pending, status, providerRef, doneAt };

    if (status === "done") {
      const totalAfter = already + amount;
      if (totalAfter >= current.grandTotal && (current.status === "returned" || current.status === "cancelled" || current.status === "refunded")) {
        // A return/cancellation can finish while the gateway call is in flight. Its terminal state
        // remains, but successful money movement and its loyalty reversal must still be recorded.
        await loyalty.reverseForOrder(tx, current, actor);
        await orderEvents.append(tx, orderId, "note", { kind: "refund.full", amount }, actor);
      } else if (totalAfter >= current.grandTotal) {
        await orderState.transition(tx, orderId, "refunded", { actor, settings: ctx.settings, payload: { refundId: row.id }, ...(ctx.restock === undefined ? {} : { restock: ctx.restock }) });
      } else {
        await orderEvents.append(tx, orderId, "note", { kind: "refund.partial", amount }, actor);
        await loyalty.reverseForRefund(tx, current, totalAfter, actor);
      }
      await jobs.enqueue(tx, "sms.send", { template: "order.cancelled", orderId, amount }, { uniqueKey: `sms:refund:${row.id}` });
    }
    await audit.log(tx, actor, "order.refund", "orders", orderId, null, { amount, via, status });
    return row;
  });
}
