import type { Db } from "@namilux/db";
import type { OrderStatus, OrderEventType } from "../constants";
import { appError } from "../errors";
import { jobs } from "../jobs";
import { loyalty } from "../loyalty/ledger";
import { assignInvoiceNo } from "./invoice";
import { cart } from "../customers/cart";
import { bumpOrderCounters } from "../customers/repo";
import { adjustStock } from "../inventory/stock";
import { consumeReservations, releaseReservations } from "../inventory/reservations";
import type { Settings } from "../settings/schema";
import type { Actor, JsonObject, Order } from "../types";
import { orderEvents } from "./events";
import { findById, lockForUpdate, payments, shipments, updateStatus } from "./repo";

export const ALLOWED: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ["pending_payment", "paid", "cancelled"],
  pending_payment: ["paid", "failed", "expired", "cancelled"],
  paid: ["processing", "cancelled", "refunded"],
  processing: ["shipped", "cancelled", "refunded"],
  shipped: ["delivered", "refunded"],
  delivered: ["returned", "refunded"],
  failed: ["pending_payment"],
  expired: ["pending_payment"],
  cancelled: [],
  refunded: [],
  returned: [],
};
export type TransitionCtx = { actor: Actor; reason?: string; payload?: JsonObject; settings: Settings; restock?: boolean };
export function canTransition(from: OrderStatus, to: OrderStatus): boolean { return (ALLOWED[from] ?? []).includes(to); }
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw appError("CONFLICT", { fa: "تغییر وضعیت مجاز نیست" });
}

/** Restock the order's items via the ledger (movement reason cancel/return; the trigger updates stock). */
async function restockItems(db: Db, order: Order, reason: "cancel" | "return", actor: Actor): Promise<void> {
  // DECISION (M8 test): inventory movements are written by staff/system/worker only (inventory/stock.ts);
  // a customer cancelling a paid order (tracking.cancelByCustomer) restocks on the system's behalf.
  const mover: Actor = actor.type === "customer" ? { type: "system", id: null } : actor;
  for (const item of order.items) {
    await adjustStock(db, item.productId, item.qty, reason, mover, order.id);
  }
}

function smsJob(db: Db, orderId: string, phone: string, template: string): Promise<string> {
  return jobs.enqueue(db, "sms.send", { template, orderId, phone }, { uniqueKey: `sms:${orderId}:${template}` });
}
function telegramJob(db: Db, orderId: string, event: string): Promise<string> {
  return jobs.enqueue(db, "telegram.notify", { event, orderId }, { uniqueKey: `tg:${orderId}:${event}` });
}

export const orderState = {
  canTransition,
  async transition(db: Db, orderId: string, to: OrderStatus, ctx: TransitionCtx): Promise<Order> {
    return db.transaction(async (tx) => {
      const order = await lockForUpdate(tx, orderId);
      if (order === null) throw appError("NOT_FOUND", { fa: "سفارش پیدا نشد" });
      assertTransition(order.status, to);
      // Refund first: SnappPay cancel/update and uncertain results belong to the refund ledger.
      // Check under the order lock so neither staff nor customer cancellation can bypass it.
      if (to === "cancelled" && (await payments.listForOrder(tx, orderId)).some((p) => p.driver === "snapppay" && p.status === "succeeded")) {
        throw appError("CONFLICT", { fa: ctx.actor.type === "customer"
          ? "برای لغو سفارش پرداخت‌شده با اسنپ‌پی، لطفاً با پشتیبانی تماس بگیرید تا بازپرداخت انجام شود."
          : "برای لغو سفارش پرداخت‌شده با اسنپ‌پی، ابتدا از بخش «بازپرداخت» باقی‌مانده مبلغ را از طریق درگاه بازگردانید." });
      }
      const from = order.status;
      const now = new Date().toISOString();
      const patch: Partial<Order> = {};
      switch (to) {
        case "paid": {
          await consumeReservations(tx, orderId, ctx.actor);
          if (order.customerId !== null) {
            await bumpOrderCounters(tx, order.customerId, order.grandTotal);
            // Only the basket of the site that was paid - the other storefront's cart is a
            // different row and a different set of prices.
            await cart.clear(tx, order.customerId, order.channel);
          }
          patch.paidAt = now;
          // M7 effects of a payment: the gapless invoice number and the loyalty earn.
          patch.pointsEarned = await loyalty.earnForOrder(tx, { ...order, paidAt: now }, ctx.settings["loyalty.rules"]);
          await assignInvoiceNo(tx, orderId, new Date(now));
          await orderEvents.append(tx, orderId, "payment.succeeded", ctx.payload ?? {}, ctx.actor);
          break;
        }
        case "processing":
          break;
        case "shipped": {
          const shipment = await shipments.latestFor(tx, orderId);
          if (shipment === null) throw appError("CONFLICT", { fa: "ابتدا اطلاعات ارسال را ثبت کنید" });
          patch.shippedAt = now;
          break;
        }
        case "delivered":
          patch.deliveredAt = now;
          break;
        case "failed":
        case "expired":
          await releaseReservations(tx, orderId);
          await loyalty.releaseRedeem(tx, orderId);
          break;
        case "cancelled": {
          // From pending_payment the reservations are still live; from paid/processing stock was
          // consumed and (restock) must be returned to the ledger.
          if (from === "pending_payment" || from === "draft") {
            await releaseReservations(tx, orderId);
            await loyalty.releaseRedeem(tx, orderId);
          } else if (ctx.restock === true) await restockItems(tx, order, "cancel", ctx.actor);
          patch.cancelledAt = now;
          if (ctx.reason !== undefined) patch.cancelReason = ctx.reason;
          break;
        }
        case "refunded":
        case "returned":
          if (ctx.restock === true) await restockItems(tx, order, "return", ctx.actor);
          if (to === "refunded") await loyalty.reverseForOrder(tx, order, ctx.actor);
          break;
        case "draft":
        case "pending_payment":
          break;
      }

      const ok = await updateStatus(tx, orderId, from, to, patch);
      if (!ok) throw appError("CONFLICT", { fa: "تغییر وضعیت مجاز نیست" });
      await orderEvents.append(tx, orderId, `status.${to}` as OrderEventType, ctx.payload ?? {}, ctx.actor);

      // Notifications (the worker sends them; enqueue only, idempotent by uniqueKey).
      if (to === "paid") {
        await smsJob(tx, orderId, order.phone, "order.paid");
        await telegramJob(tx, orderId, "order.paid");
      } else if (to === "shipped") {
        await smsJob(tx, orderId, order.phone, "order.shipped");
      } else if (to === "delivered") {
        await smsJob(tx, orderId, order.phone, "order.delivered");
      } else if (to === "expired") {
        await smsJob(tx, orderId, order.phone, "order.expired");
      } else if (to === "cancelled") {
        await smsJob(tx, orderId, order.phone, "order.cancelled");
      } else if (to === "returned") {
        await smsJob(tx, orderId, order.phone, "return.received");
      }

      const updated = await findById(tx, orderId);
      if (updated === null) throw appError("INTERNAL", { details: "order vanished during transition" });
      return updated;
    });
  },
};
