import type { Db } from "@namilux/db";
import { RETURN_WINDOW_DAYS } from "../constants";
import type { ShipmentCarrier } from "../constants";
import { appError } from "../errors";
import { ulid } from "../ids";
import type { Settings } from "../settings/schema";
import type { CustomerOrderRow, CustomerOrderView, Order, OrderTrackView, OrderView, Paged, Payment } from "../types";
import type { ReturnRequestInput } from "../validation/checkout";
import { orderEvents } from "./events";
import { findByCode, findByCodeAndPhone, listForCustomer, payments as paymentsRepo, shipments } from "./repo";
import { orderState } from "./state";
import { customerOrderRow, customerOrderView, customerTrackingView } from "./customer-view";

type PaymentSummary = Pick<Payment, "driver" | "status" | "refId" | "cardPanMasked" | "verifiedAt">;

// Exported for orders/admin.ts adminDetail (the admin view is this plus the raw satellite lists).
export async function buildView(db: Db, order: Order): Promise<OrderView> {
  const [events, allPayments, shipment] = await Promise.all([
    orderEvents.list(db, order.id),
    paymentsRepo.listForOrder(db, order.id),
    shipments.latestFor(db, order.id),
  ]);
  const succeeded = allPayments.find((p) => p.status === "succeeded");
  const chosen = succeeded ?? allPayments[0];
  const payment: PaymentSummary | null =
    chosen === undefined ? null : { driver: chosen.driver, status: chosen.status, refId: chosen.refId, cardPanMasked: chosen.cardPanMasked, verifiedAt: chosen.verifiedAt };
  const deliveredMs = order.deliveredAt === null ? null : Date.parse(order.deliveredAt);
  const withinReturn = deliveredMs !== null && Date.now() - deliveredMs <= RETURN_WINDOW_DAYS * 86_400_000;
  return {
    ...order,
    events,
    payment,
    shipment,
    // A SnappPay purchase is cancelled through the refund (it also cancels the shopper's
    // instalments), which staff run; the shopper asks support instead of pressing a button.
    canCancel: (order.status === "pending_payment" || order.status === "paid") && succeeded?.driver !== "snapppay",
    cancelViaSupport: (order.status === "paid" || order.status === "processing") && succeeded?.driver === "snapppay",
    canReturn: order.status === "delivered" && withinReturn,
    canRetryPayment: (order.status === "failed" || order.status === "expired" || order.status === "pending_payment") && succeeded === undefined,
    isTest: payment?.driver === "mock",
  };
}

export async function getOrderForCustomer(db: Db, code: string, customerId: string, channel?: Order["channel"]): Promise<CustomerOrderView | null> {
  const order = await findByCode(db, code);
  // Ownership is mandatory. The optional channel filter is for callers that deliberately scope a
  // report; the unified storefront omits it so historical instalment purchases remain accessible.
  if (order === null || order.customerId !== customerId || (channel !== undefined && order.channel !== channel)) return null;
  return customerOrderView(await buildView(db, order));
}

export async function listOrdersForCustomer(db: Db, customerId: string, page = 1, channel?: Order["channel"]): Promise<Paged<CustomerOrderRow>> {
  const result = await listForCustomer(db, customerId, page, channel);
  return { ...result, items: result.items.map(customerOrderRow) };
}

export async function trackOrder(db: Db, code: string, phone: string, channel?: Order["channel"]): Promise<OrderTrackView | null> {
  // A wrong phone is indistinguishable from an unknown code (no enumeration).
  const order = await findByCodeAndPhone(db, code, phone, channel);
  if (order === null) return null;
  return customerTrackingView(await buildView(db, order));
}

export async function cancelByCustomer(db: Db, code: string, customerId: string, reason: string, ctx: { settings: Settings; channel?: Order["channel"] }): Promise<Order> {
  const order = await findByCode(db, code);
  if (order === null || order.customerId !== customerId || (ctx.channel !== undefined && order.channel !== ctx.channel)) throw appError("NOT_FOUND", { fa: "سفارش پیدا نشد" });
  const actor = { type: "customer" as const, id: customerId };
  if (order.status === "pending_payment") {
    return orderState.transition(db, order.id, "cancelled", { actor, reason, settings: ctx.settings });
  }
  if (order.status === "paid") {
    // Card payments cancel and restock locally; the state guard requires a gateway refund first
    // for SnappPay so its credit cannot remain charged against a cancelled order.
    const cancelled = await orderState.transition(db, order.id, "cancelled", { actor, reason, restock: true, settings: ctx.settings });
    await orderEvents.append(db, order.id, "refund.requested", { reason }, actor);
    return cancelled;
  }
  throw appError("CONFLICT", { fa: "سفارش در حال آماده‌سازی است؛ با پشتیبانی تماس بگیرید" });
}

export async function requestReturn(db: Db, code: string, customerId: string, input: ReturnRequestInput, channel?: Order["channel"]): Promise<{ id: string }> {
  const order = await findByCode(db, code);
  if (order === null || order.customerId !== customerId || (channel !== undefined && order.channel !== channel)) throw appError("NOT_FOUND", { fa: "سفارش پیدا نشد" });
  if (order.status !== "delivered") throw appError("CONFLICT", { fa: "این سفارش قابل مرجوع کردن نیست" });
  const deliveredMs = order.deliveredAt === null ? 0 : Date.parse(order.deliveredAt);
  if (Date.now() - deliveredMs > RETURN_WINDOW_DAYS * 86_400_000) {
    throw appError("CONFLICT", { fa: `مهلت مرجوع کردن (${RETURN_WINDOW_DAYS} روز) گذشته است` });
  }
  // DECISION: returns live as a tagged `note` order event (+ inbox item) until the P1
  // returns table and its `return.requested` event type land - there is no such OrderEventType yet.
  const existing = (await orderEvents.list(db, order.id)).some((e) => e.type === "note" && (e.payload as { kind?: string } | null)?.kind === "return");
  if (existing) throw appError("CONFLICT", { fa: "درخواست مرجوع قبلاً ثبت شده است" });
  const id = ulid();
  await orderEvents.append(db, order.id, "note", { kind: "return", reason: input.reason, requestId: id }, { type: "customer", id: customerId });
  return { id };
}

export function trackingUrl(carrier: ShipmentCarrier, code: string | null): string | null {
  if (code === null || code === "") return null;
  if (carrier === "post") return `https://tracking.post.ir/?id=${encodeURIComponent(code)}`;
  if (carrier === "tipax") return `https://tipaxco.com/tracking/${encodeURIComponent(code)}`;
  return null;
}
