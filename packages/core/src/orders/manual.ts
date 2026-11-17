import type { Db } from "@namilux/db";
import type { ManualPaymentMethod } from "../constants";
import type { Settings } from "../settings/schema";
import type { Actor, ManualOrderInput, Order, OrderItem, OrderShippingSnapshot, PricedLine } from "../types";
import { appError } from "../errors";
import { normalizePhone } from "../persian";
import { audit } from "../audit";
import { jobs } from "../jobs";
import { ensureCustomerForPhone } from "../customers/service";
import { listActiveShippingMethods, loadProductsForQuote } from "../inventory/repo";
import { reserve } from "../inventory/reservations";
import { shippingOptions } from "../pricing/shipping";
import { findById, insertOrder, payments as paymentsRepo, updateOrder, updateStatus } from "./repo";
import { orderEvents } from "./events";
import { paymentLinkFor } from "./payments";
import { orderState } from "./state";

type CreateResult = { items: Omit<OrderItem, "id" | "orderId">[]; priced: PricedLine[]; subtotal: number };

/** Build the order items + priced lines from the staff input (override or the product's own price). */
function buildLines(input: ManualOrderInput, byId: Map<number, Awaited<ReturnType<typeof loadProductsForQuote>>[number]>): CreateResult {
  const items: Omit<OrderItem, "id" | "orderId">[] = [];
  const priced: PricedLine[] = [];
  let subtotal = 0;
  for (const it of input.items) {
    const p = byId.get(it.productId);
    if (p === undefined) throw appError("NOT_FOUND", { fa: "کالا پیدا نشد", details: { productId: it.productId } });
    if (p.status === "archived") throw appError("CONFLICT", { fa: "کالای بایگانی‌شده قابل فروش نیست", details: { productId: it.productId } });
    const unitPrice = it.unitPriceOverride ?? p.price;
    if (!Number.isSafeInteger(unitPrice) || unitPrice < 1) {
      throw appError("ON_REQUEST", { fa: "برای این کالا قیمت را وارد کنید", details: { productId: it.productId } });
    }
    const lineTotal = unitPrice * it.qty;
    subtotal += lineTotal;
    priced.push({ productId: it.productId, unitPrice, qty: it.qty, compareAt: p.compareAt });
    items.push({
      productId: it.productId,
      name: p.displayName,
      sku: p.sku,
      modelCode: p.modelCode,
      colorName: p.colorName,
      imageKey: p.imageKey,
      unitPrice,
      compareAtPrice: p.compareAt,
      qty: it.qty,
      lineTotal,
      warrantyMonths: p.warrantyMonths,
    });
  }
  if (items.length === 0) throw appError("VALIDATION", { fa: "سبد خرید خالی است" });
  return { items, priced, subtotal };
}

async function resolveShipping(
  db: Db,
  methodKey: string,
  province: string,
  subtotal: number,
): Promise<{ snapshot: OrderShippingSnapshot; cost: number }> {
  const methods = await listActiveShippingMethods(db);
  const chosen = shippingOptions(methods, province, subtotal).find((o) => o.key === methodKey);
  const cost = chosen?.cost ?? 0;
  const snapshot: OrderShippingSnapshot = chosen ?? { key: methodKey, name: "", etaMin: 0, etaMax: 0, cost };
  return { snapshot, cost };
}

export async function createManualOrder(
  db: Db,
  input: ManualOrderInput,
  actor: Actor,
  ctx: { settings: Settings },
): Promise<Order> {
  void ctx;
  const phone = normalizePhone(input.phone);
  if (phone === null) throw appError("VALIDATION", { fa: "شمارهٔ موبایل نامعتبر است" });

  let customerId = input.customerId;
  if (customerId === null) {
    const { customer } = await ensureCustomerForPhone(db, phone, { referralCode: null });
    customerId = customer.id;
  }

  const products = await loadProductsForQuote(db, input.items.map((i) => i.productId), { lock: "none" });
  const byId = new Map(products.map((p) => [p.id, p]));
  const { items, subtotal } = buildLines(input, byId);

  const discount = Math.min(input.discount?.amount ?? 0, subtotal);
  const { snapshot: shipping, cost: shippingCost } = await resolveShipping(db, input.shippingMethodKey, input.address.province, subtotal);
  const grandTotal = subtotal - discount + shippingCost;
  const nowIso = new Date().toISOString();

  const order = await insertOrder(db, {
    invoiceNo: null,
    customerId,
    phone,
    email: null,
    status: "draft",
    source: input.source,
    // A manual order is priced by staff from the FIXED price list, so it belongs to the main site
    // whatever domain the customer originally came from.
    channel: "main",
    channelRef: input.channelRef ?? null,
    subtotal,
    discountTotal: discount,
    shippingTotal: shippingCost,
    pointsDiscount: 0,
    grandTotal,
    couponId: null,
    couponCode: null,
    pointsRedeemed: 0,
    pointsEarned: 0,
    shippingMethodKey: input.shippingMethodKey,
    shipping,
    address: input.address,
    customerNote: null,
    adminNote: input.adminNote ?? null,
    giftMessage: null,
    isGift: false,
    placedAt: nowIso,
    paidAt: null,
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    expiresAt: null,
    items,
  });

  await orderEvents.append(db, order.id, "note", { kind: "manual.created", source: input.source, note: input.discount?.note ?? null }, actor);
  await audit.log(db, actor, "order.manual.create", "orders", order.id, undefined, { source: input.source, grandTotal });
  // the spec: a staff price override is audited with its reason (the permission itself is asserted by the route).
  const overrides = input.items.filter((i) => i.unitPriceOverride !== undefined).map((i) => ({ productId: i.productId, unitPrice: i.unitPriceOverride ?? 0, reason: i.overrideReason ?? "" }));
  if (overrides.length > 0) await audit.log(db, actor, "order.manual.override", "orders", order.id, undefined, { overrides });
  return order;
}

export async function submitManualOrder(
  db: Db,
  orderId: string,
  mode: "payment_link" | "mark_paid",
  actor: Actor,
  ctx: { settings: Settings; env: { SITE_ORIGIN: string }; manual?: { method: ManualPaymentMethod; reference: string } },
): Promise<Order> {
  const order = await findById(db, orderId);
  if (order === null) throw appError("NOT_FOUND", { details: { orderId } });
  if (order.status !== "draft") throw appError("CONFLICT", { fa: "این سفارش پیش‌نویس نیست" });

  const lines = order.items.map((i) => ({ productId: i.productId, qty: i.qty }));
  const ttl = ctx.settings["commerce.pending_ttl_min"];

  if (mode === "payment_link") {
    const manualTtl = ttl * 4; // the spec: manual links live longer than the checkout pending TTL.
    await db.transaction(async (tx) => {
      await reserve(tx, orderId, lines, manualTtl);
      // draft → pending_payment is the one transition whose only side-effect is the event (state.ts),
      // so it is done here with updateStatus (which can set expires_at) + the "placed" event.
      await updateStatus(tx, orderId, "draft", "pending_payment", { expiresAt: new Date(Date.now() + manualTtl * 60_000).toISOString() });
      await orderEvents.append(tx, orderId, "placed", { source: order.source, manual: true }, actor);
    });
    const updated = await findById(db, orderId);
    if (updated === null) throw appError("NOT_FOUND", { details: { orderId } });
    const payUrl = paymentLinkFor(updated, ctx.env);
    await jobs.enqueue(
      db,
      "sms.send",
      { template: "order.placed_pending", orderId, phone: order.phone, payUrl },
      { uniqueKey: `order:${orderId}:placed_pending` },
    );
    await audit.log(db, actor, "order.manual.payment_link", "orders", orderId, undefined, { payUrl });
    return updated;
  }

  // mark_paid - sudo asserted by the route.
  const manual = ctx.manual;
  if (manual === undefined) throw appError("VALIDATION", { fa: "روش و مرجع پرداخت را وارد کنید" });
  await db.transaction(async (tx) => {
    await reserve(tx, orderId, lines, ttl);
    await paymentsRepo.insert(tx, {
      orderId,
      driver: "manual",
      amount: order.grandTotal,
      status: "succeeded",
      authority: null,
      refId: manual.reference,
      cardPanMasked: null,
      fee: null,
    });
  });
  const paid = await orderState.transition(db, orderId, "paid", {
    actor,
    settings: ctx.settings,
    payload: { method: manual.method, reference: manual.reference },
  });
  await audit.log(db, actor, "order.manual_paid", "orders", orderId, undefined, { method: manual.method, reference: manual.reference });
  return paid;
}

export async function markPaidManually(
  db: Db,
  orderId: string,
  i: { method: ManualPaymentMethod; reference: string },
  actor: Actor,
  ctx: { settings: Settings },
): Promise<Order> {
  const order = await findById(db, orderId);
  if (order === null) throw appError("NOT_FOUND", { details: { orderId } });
  if (order.status !== "pending_payment") throw appError("CONFLICT", { fa: "این سفارش در انتظار پرداخت نیست" });
  await paymentsRepo.insert(db, {
    orderId,
    driver: "manual",
    amount: order.grandTotal,
    status: "succeeded",
    authority: null,
    refId: i.reference,
    cardPanMasked: null,
    fee: null,
  });
  const paid = await orderState.transition(db, orderId, "paid", { actor, settings: ctx.settings, payload: { method: i.method, reference: i.reference } });
  await audit.log(db, actor, "order.manual_paid", "orders", orderId, undefined, { method: i.method, reference: i.reference });
  return paid;
}

export async function updateDraft(
  db: Db,
  orderId: string,
  patch: Partial<ManualOrderInput>,
  actor: Actor,
  ctx: { settings: Settings },
): Promise<Order> {
  void ctx;
  const order = await findById(db, orderId);
  if (order === null) throw appError("NOT_FOUND", { details: { orderId } });
  if (order.status !== "draft") throw appError("CONFLICT", { fa: "فقط پیش‌نویس قابل ویرایش است" });

  // DECISION: item edits on a draft re-run createManualOrder's build; this fast path updates the
  // non-item fields (address / shipping / discount / note) and recomputes shipping + grand total.
  const address = patch.address ?? order.address;
  const shippingMethodKey = patch.shippingMethodKey ?? order.shippingMethodKey;
  const discount = Math.min(patch.discount?.amount ?? order.discountTotal, order.subtotal);
  const { snapshot: shipping, cost: shippingCost } = await resolveShipping(db, shippingMethodKey, address.province, order.subtotal);
  const grandTotal = order.subtotal - discount + shippingCost;

  // updateOrder cannot change shippingMethodKey (admin-editable set, the spec); the snapshot carries the
  // key, and the fast path keeps the same method - a method change re-creates the draft.
  void shippingMethodKey;
  await updateOrder(db, orderId, {
    address,
    shipping,
    discountTotal: discount,
    shippingTotal: shippingCost,
    grandTotal,
    ...(patch.adminNote === undefined ? {} : { adminNote: patch.adminNote }),
  });
  await audit.log(db, actor, "order.draft.update", "orders", orderId, undefined, { grandTotal });
  const updated = await findById(db, orderId);
  if (updated === null) throw appError("NOT_FOUND", { details: { orderId } });
  return updated;
}
