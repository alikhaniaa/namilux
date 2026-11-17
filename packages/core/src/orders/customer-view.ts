import type { CustomerOrderRow, CustomerOrderView, OrderRow, OrderTrackView, OrderView } from "../types";
import { maskPhone } from "../persian";
import { orderEvents } from "./events";

/** Only public fields cross the account/API boundary; nested snapshots are projected too. */
export function customerOrderView(order: OrderView): CustomerOrderView {
  const a = order.address;
  const s = order.shipping;
  const p = order.payment;
  const shipment = order.shipment;
  return {
    id: order.id,
    code: order.code,
    invoiceNo: order.invoiceNo,
    status: order.status,
    channel: order.channel,
    phone: order.phone,
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingTotal: order.shippingTotal,
    pointsDiscount: order.pointsDiscount,
    grandTotal: order.grandTotal,
    pointsRedeemed: order.pointsRedeemed,
    pointsEarned: order.pointsEarned,
    shipping: { key: s.key, name: s.name, cost: s.cost, etaMin: s.etaMin, etaMax: s.etaMax },
    address: {
      label: a.label, recipientName: a.recipientName, recipientPhone: a.recipientPhone,
      province: a.province, city: a.city, address: a.address, plaque: a.plaque,
      unit: a.unit, postcode: a.postcode,
    },
    customerNote: order.customerNote,
    giftMessage: order.giftMessage,
    isGift: order.isGift,
    items: order.items.map((i) => ({
      id: i.id, productId: i.productId, name: i.name, sku: i.sku, modelCode: i.modelCode,
      colorName: i.colorName, imageKey: i.imageKey, unitPrice: i.unitPrice,
      compareAtPrice: i.compareAtPrice, qty: i.qty, lineTotal: i.lineTotal, warrantyMonths: i.warrantyMonths,
    })),
    placedAt: order.placedAt,
    paidAt: order.paidAt,
    shippedAt: order.shippedAt,
    deliveredAt: order.deliveredAt,
    cancelledAt: order.cancelledAt,
    expiresAt: order.expiresAt,
    payment: p === null ? null : {
      // SnappPay stores its privileged paymentToken in refId; only bank references are public.
      driver: p.driver, status: p.status, refId: p.driver === "snapppay" ? null : p.refId,
      cardPanMasked: p.cardPanMasked, verifiedAt: p.verifiedAt,
    },
    shipment: shipment === null ? null : {
      carrier: shipment.carrier, trackingCode: shipment.trackingCode, trackingUrl: shipment.trackingUrl,
      status: shipment.status, shippedAt: shipment.shippedAt, deliveredAt: shipment.deliveredAt,
    },
    timeline: orderEvents.customerTimeline(order.events),
    canCancel: order.canCancel,
    cancelViaSupport: order.cancelViaSupport,
    canReturn: order.canReturn,
    canRetryPayment: order.canRetryPayment,
    isTest: order.isTest,
  };
}

export function customerOrderRow(order: OrderRow): CustomerOrderRow {
  return {
    id: order.id, code: order.code, itemsCount: order.itemsCount, grandTotal: order.grandTotal,
    status: order.status, paymentStatus: order.paymentStatus, paymentDriver: order.paymentDriver,
    method: order.method, shipmentStatus: order.shipmentStatus, channel: order.channel, placedAt: order.placedAt,
  };
}

/** The public tracking page gets no address, payment reference, raw phone or internal identifiers. */
export function customerTrackingView(order: OrderView): OrderTrackView {
  return {
    code: order.code,
    status: order.status,
    grandTotal: order.grandTotal,
    items: order.items.map(({ id, name, qty, lineTotal }) => ({ id, name, qty, lineTotal })),
    timeline: orderEvents.customerTimeline(order.events),
    phoneMasked: maskPhone(order.phone),
  };
}
