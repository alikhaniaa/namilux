import type { Db } from "@namilux/db";
import type { ShipmentCarrier, SmsTemplate } from "../constants";
import type { Settings } from "../settings/schema";
import type {
  OrderItem,
  Actor,
  CustomerRow,
  Order,
  OrderAddressSnapshot,
  OrderEvent,
  OrderQuery,
  OrderView,
  OrdersPage,
  Payment,
  Refund,
  Shipment,
} from "../types";
import { appError } from "../errors";
import { audit } from "../audit";
import { jobs } from "../jobs";
import { orderEvents } from "./events";
import type { SalesChannel } from "../channel";
import { channelCounts, methodCounts, snapppayAttentionCount, findByCode, findById, listAdmin, payments as paymentsRepo, refunds as refundsRepo, replaceItems, shipments, updateOrder } from "./repo";
import { findAdminRow } from "../catalog/products.repo";
import { ulid } from "../ids";
import { orderState } from "./state";
import { buildView } from "./tracking";

export async function listOrders(db: Db, q: OrderQuery): Promise<OrdersPage> {
  return listAdmin(db, q);
}

/** The per-payment-method counts under the list's other filters (the method switch). */
export async function orderMethodCounts(db: Db, q: OrderQuery): Promise<Record<string, number>> {
  return methodCounts(db, q);
}

/** SnappPay orders that need a person (verified-not-settled, unresolved refunds, late successes). */
export async function snapppayAttention(db: Db): Promise<number> {
  return snapppayAttentionCount(db);
}

/** The per-storefront counts under the list's other filters (the switch above the orders table). */
export async function orderChannelCounts(db: Db, q: OrderQuery): Promise<Record<SalesChannel, number>> {
  return channelCounts(db, q);
}

export async function adminDetail(
  db: Db,
  code: string,
): Promise<
  OrderView & {
    payments: Payment[];
    refunds: Refund[];
    shipments: Shipment[];
    events: OrderEvent[];
    smsLog: { template: string; status: string; at: string }[];
    customer: CustomerRow | null;
  }
> {
  const order = await findByCode(db, code);
  if (order === null) throw appError("NOT_FOUND", { details: { entity: "order", code } });
  const [view, allPayments, allRefunds, latestShipment] = await Promise.all([
    buildView(db, order),
    paymentsRepo.listForOrder(db, order.id),
    refundsRepo.listForOrder(db, order.id),
    shipments.latestFor(db, order.id),
  ]);
  // DECISION: sms_log is keyed by a hashed phone, not by order - a per-order SMS log needs a
  // join the sms_log table does not carry, so [] here; the order timeline (events) shows sends.
  // DECISION: customer is null pending a CustomerRow admin fetch (tier is derived, not a column);
  // the detail page loads it from /api/customers/[id].
  return {
    ...view,
    payments: allPayments,
    refunds: allRefunds,
    shipments: latestShipment === null ? [] : [latestShipment],
    events: view.events,
    smsLog: [],
    customer: null,
  };
}

export type EditItemsInput = { items: { productId: number; qty: number; unitPriceOverride?: number }[] };

/**
 * the spec: items are editable before `processing`. Prices come from the product row (or the
 * existing snapshot for an unchanged line); an override needs `catalog.price` (opts.allowOverride).
 * Totals are recomputed with the existing discount/points/shipping kept; a paid order whose total
 * moved gets a `refund.requested` (lower) or a note (higher) so the staff settles the difference.
 */
export async function editItems(db: Db, orderId: string, input: EditItemsInput, actor: Actor, opts: { allowOverride: boolean }): Promise<Order> {
  const order = await findById(db, orderId);
  if (order === null) throw appError("NOT_FOUND", { details: { orderId } });
  if (order.status !== "draft" && order.status !== "pending_payment" && order.status !== "paid") {
    throw appError("CONFLICT", { fa: "پس از شروع پردازش، اقلام قابل ویرایش نیست" });
  }
  if (input.items.length === 0) throw appError("VALIDATION", { fa: "سفارش باید دست‌کم یک قلم داشته باشد" });
  const rows: OrderItem[] = [];
  for (const line of input.items) {
    const existing = order.items.find((i) => i.productId === line.productId);
    const p = await findAdminRow(db, line.productId);
    if (p === null) throw appError("VALIDATION", { fa: "محصول پیدا نشد", details: { productId: line.productId } });
    if (line.unitPriceOverride !== undefined && !opts.allowOverride) throw appError("FORBIDDEN", { fa: "تغییر قیمت نیاز به دسترسی قیمت‌گذاری دارد" });
    const unitPrice = line.unitPriceOverride ?? existing?.unitPrice ?? p.price;
    if (unitPrice <= 0) throw appError("ON_REQUEST", { details: { productId: line.productId } });
    const qty = Math.max(1, Math.trunc(line.qty));
    rows.push({
      id: existing?.id ?? ulid(),
      productId: line.productId,
      name: existing?.name ?? p.displayName,
      sku: p.sku,
      modelCode: p.modelCode,
      colorName: p.colorName,
      imageKey: existing?.imageKey ?? null,
      unitPrice,
      compareAtPrice: p.compareAtPrice,
      qty,
      lineTotal: unitPrice * qty,
      warrantyMonths: p.warrantyMonths,
    });
  }
  const subtotal = rows.reduce((sum, r) => sum + r.lineTotal, 0);
  const grandTotal = Math.max(0, subtotal - order.discountTotal - order.pointsDiscount + order.shippingTotal);
  await replaceItems(db, orderId, rows);
  await updateOrder(db, orderId, { subtotal, grandTotal });
  await orderEvents.append(db, orderId, "items.edited", { before: order.grandTotal, after: grandTotal, lines: rows.length }, actor);
  if (order.status === "paid" && grandTotal !== order.grandTotal) {
    const diff = order.grandTotal - grandTotal;
    if (diff > 0) await orderEvents.append(db, orderId, "refund.requested", { amount: diff, reason: "items.edited" }, actor);
    else await orderEvents.append(db, orderId, "note", { kind: "extra.payment", amount: -diff }, actor);
  }
  await audit.log(db, actor, "order.items.edit", "orders", orderId, { grandTotal: order.grandTotal, lines: order.items.length }, { grandTotal, lines: rows.length });
  const updated = await findById(db, orderId);
  if (updated === null) throw appError("NOT_FOUND", { details: { orderId } });
  return updated;
}

export async function editAddress(
  db: Db,
  orderId: string,
  address: OrderAddressSnapshot,
  actor: Actor,
): Promise<Order> {
  const order = await findById(db, orderId);
  if (order === null) throw appError("NOT_FOUND", { details: { orderId } });
  if (order.status === "shipped" || order.status === "delivered") {
    throw appError("CONFLICT", { fa: "پس از ارسال، نشانی قابل ویرایش نیست" });
  }
  await updateOrder(db, orderId, { address });
  await orderEvents.append(db, orderId, "note", { kind: "address.edit" }, actor);
  await audit.log(db, actor, "order.address.edit", "orders", orderId, { address: order.address }, { address });
  const updated = await findById(db, orderId);
  if (updated === null) throw appError("NOT_FOUND", { details: { orderId } });
  return updated;
}

export async function recordShipment(
  db: Db,
  orderId: string,
  s: { carrier: ShipmentCarrier; trackingCode?: string; cost?: number; note?: string },
  actor: Actor,
  ctx: { settings: Settings },
): Promise<Order> {
  const order = await findById(db, orderId);
  if (order === null) throw appError("NOT_FOUND", { details: { orderId } });
  await shipments.insert(db, {
    orderId,
    carrier: s.carrier,
    trackingCode: s.trackingCode ?? null,
    trackingUrl: null,
    status: "shipped",
    cost: s.cost ?? 0,
    note: s.note ?? null,
    shippedAt: new Date().toISOString(),
    deliveredAt: null,
  });
  // transition(shipped) requires the shipments row (state.ts) and sends "order.shipped".
  return orderState.transition(db, orderId, "shipped", { actor, settings: ctx.settings });
}

export async function markDelivered(db: Db, orderId: string, actor: Actor, ctx: { settings: Settings }): Promise<Order> {
  return orderState.transition(db, orderId, "delivered", { actor, settings: ctx.settings });
}

export async function addNote(db: Db, orderId: string, note: string, actor: Actor): Promise<void> {
  const order = await findById(db, orderId);
  if (order === null) throw appError("NOT_FOUND", { details: { orderId } });
  const next = order.adminNote === null || order.adminNote.trim() === "" ? note : `${order.adminNote}\n${note}`;
  await updateOrder(db, orderId, { adminNote: next });
  await orderEvents.append(db, orderId, "note", { note }, actor);
  await audit.log(db, actor, "order.note.add", "orders", orderId, undefined, { note });
}

export async function resendSms(db: Db, orderId: string, template: SmsTemplate, actor: Actor): Promise<void> {
  const order = await findById(db, orderId);
  if (order === null) throw appError("NOT_FOUND", { details: { orderId } });
  const minute = Math.floor(Date.now() / 60_000);
  await jobs.enqueue(
    db,
    "sms.send",
    { template, orderId, phone: order.phone },
    { uniqueKey: `order:${orderId}:${template}:${minute}` },
  );
  await audit.log(db, actor, "order.sms.resend", "orders", orderId, undefined, { template });
}

export async function cancelByStaff(
  db: Db,
  orderId: string,
  reason: string,
  restock: boolean,
  actor: Actor,
  ctx: { settings: Settings },
): Promise<Order> {
  return orderState.transition(db, orderId, "cancelled", { actor, reason, restock, settings: ctx.settings });
}
