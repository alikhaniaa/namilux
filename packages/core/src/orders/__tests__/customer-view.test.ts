import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@namilux/db";
import type { OrderRow, OrderView } from "../../types";
import { DEFAULT_SETTINGS } from "../../settings/schema";
import { customerOrderRow, customerOrderView, customerTrackingView } from "../customer-view";
import { orderEvents } from "../events";
import * as repo from "../repo";
import { orderState } from "../state";
import { buildView, cancelByCustomer, getOrderForCustomer, listOrdersForCustomer, requestReturn, trackOrder } from "../tracking";

const db = {} as Db;
const at = "2026-10-08T00:00:00.000Z";

function fixture(): OrderView {
  return {
    id: "ORDER", code: "NL-ABCDE", invoiceNo: 17, customerId: "CUSTOMER", phone: "09121234567",
    email: "PRIVATE@example.test", status: "shipped", source: "web", channel: "instalments", channelRef: "PRIVATE-ref",
    subtotal: 100_000, discountTotal: 0, shippingTotal: 0, pointsDiscount: 0, grandTotal: 100_000,
    couponId: null, couponCode: null, pointsRedeemed: 0, pointsEarned: 10,
    shippingMethodKey: "free_nationwide", shipping: { key: "free_nationwide", name: "ارسال", cost: 0, etaMin: 1, etaMax: 3 },
    address: { label: "خانه", recipientName: "نام گیرنده", recipientPhone: "09121234567", province: "THR", city: "تهران", address: "نشانی شخصی مشتری", plaque: "1", unit: null, postcode: "1234512345" },
    customerNote: "customer note", adminNote: "PRIVATE internal staff note", giftMessage: null, isGift: false,
    items: [{ id: "ITEM", productId: 1, name: "کالا", sku: "SKU", modelCode: null, colorName: null, imageKey: null, unitPrice: 100_000, compareAtPrice: null, qty: 1, lineTotal: 100_000, warrantyMonths: null }],
    placedAt: at, paidAt: at, shippedAt: at, deliveredAt: null, cancelledAt: null, cancelReason: "PRIVATE reason", expiresAt: null, createdAt: at, updatedAt: at,
    events: [
      { id: 1, type: "placed", payload: {}, actor: { type: "customer", id: "CUSTOMER" }, createdAt: at },
      { id: 2, type: "note", payload: { note: "PRIVATE event note" }, actor: { type: "staff", id: "PRIVATE-staff" }, createdAt: at },
      { id: 3, type: "status.shipped", payload: { carrier: "post", trackingCode: "123", trackingUrl: "https://tracking.post.ir/?id=123", note: "PRIVATE shipment event" }, actor: { type: "staff", id: "PRIVATE-staff" }, createdAt: at },
    ],
    payment: { driver: "snapppay", status: "succeeded", refId: "PRIVATE-provider-payment-token", cardPanMasked: null, verifiedAt: at },
    shipment: { id: "SHIPMENT", orderId: "ORDER", carrier: "post", trackingCode: "123", trackingUrl: "https://tracking.post.ir/?id=123", status: "shipped", cost: 23_000, shippedAt: at, deliveredAt: null, note: "PRIVATE carrier note" },
    canCancel: false, cancelViaSupport: false, canReturn: false, canRetryPayment: false, isTest: false,
  };
}

describe("customer order projections", () => {
  it("preserves customer details and timeline without staff fields or nested private data", () => {
    const order = fixture();
    Object.assign(order, { futureInternalField: "PRIVATE future field" });
    Object.assign(order.address, { internal: "PRIVATE nested address data" });
    Object.assign(order.items[0] ?? {}, { internal: "PRIVATE nested item data" });
    const result = customerOrderView(order);
    expect(result.address.recipientName).toBe(order.address.recipientName);
    expect(result.payment?.refId).toBeNull();
    expect(result.timeline.find((s) => s.key === "shipped")?.tracking).toEqual({ carrier: "post", code: "123", url: "https://tracking.post.ir/?id=123" });
    expect(result).not.toHaveProperty("events");
    expect(result).not.toHaveProperty("adminNote");
    expect(result.shipment).not.toHaveProperty("cost");
    expect(result.shipment).not.toHaveProperty("note");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it("keeps a bank payment receipt while hiding SnappPay provider tokens", () => {
    const order = fixture();
    order.payment = { driver: "zarinpal", status: "succeeded", refId: "bank-receipt", cardPanMasked: "1234******5678", verifiedAt: at };
    expect(customerOrderView(order).payment).toEqual(order.payment);
    order.payment.driver = "snapppay";
    expect(customerOrderView(order).payment?.refId).toBeNull();
  });

  it("public tracking omits identity, delivery address and payment details", () => {
    const order = fixture();
    const result = customerTrackingView(order);
    expect(result).toMatchObject({ code: order.code, status: "shipped", grandTotal: 100_000, items: [{ name: "کالا", qty: 1, lineTotal: 100_000 }] });
    for (const key of ["id", "customerId", "phone", "address", "payment", "events", "shipment", "adminNote", "customerNote", "giftMessage"]) {
      expect(result).not.toHaveProperty(key);
    }
    expect(result.phoneMasked).toContain("*");
    expect(JSON.stringify(result)).not.toContain(order.phone);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it("order history omits staff flags and internal-note presence", () => {
    const row: OrderRow = { id: "ORDER", code: "NL-ABCDE", customerName: "PRIVATE-name", phoneMasked: "0912***4567", itemsCount: 1, grandTotal: 100_000, status: "paid", paymentStatus: "succeeded", paymentDriver: "snapppay", method: "snapppay", shipmentStatus: null, source: "web", channel: "instalments", placedAt: at, hasNote: true, flagged: true };
    const result = customerOrderRow(row);
    expect(result.code).toBe(row.code);
    expect(result).not.toHaveProperty("flagged");
    expect(result).not.toHaveProperty("hasNote");
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
});

describe("historical order access on the unified storefront", () => {
  let order: OrderView;
  beforeEach(() => {
    order = fixture();
    vi.spyOn(repo, "findByCode").mockImplementation(async (_db, code) => code === order.code ? order : null);
    vi.spyOn(repo, "findByCodeAndPhone").mockImplementation(async (_db, code, phone, channel) => code === order.code && phone === order.phone && (channel === undefined || channel === order.channel) ? order : null);
    vi.spyOn(repo.payments, "listForOrder").mockResolvedValue([]);
    vi.spyOn(repo.shipments, "latestFor").mockImplementation(async () => order.shipment);
    vi.spyOn(orderEvents, "list").mockImplementation(async () => order.events);
    vi.spyOn(orderEvents, "append").mockResolvedValue({ id: 4, type: "note", payload: {}, actor: { type: "customer", id: "CUSTOMER" }, createdAt: at });
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns an owner's historical purchase and retains private fields only in the admin view", async () => {
    const mine = await getOrderForCustomer(db, order.code, "CUSTOMER");
    expect(mine?.channel).toBe("instalments");
    expect(JSON.stringify(mine)).not.toContain("PRIVATE");
    expect(await getOrderForCustomer(db, order.code, "ANOTHER_CUSTOMER")).toBeNull();
    expect((await buildView(db, order)).adminNote).toContain("PRIVATE");
    expect(await getOrderForCustomer(db, "NL-WRONG", "CUSTOMER")).toBeNull();
  });

  it("tracking still requires both the original code and phone", async () => {
    expect((await trackOrder(db, order.code, order.phone))?.code).toBe(order.code);
    expect(await trackOrder(db, order.code, "09120000000")).toBeNull();
    expect(repo.findByCodeAndPhone).toHaveBeenCalledWith(db, order.code, order.phone, undefined);
  });

  it("lists all channels while retaining the customer filter", async () => {
    const list = vi.spyOn(repo, "listForCustomer").mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
    await listOrdersForCustomer(db, "CUSTOMER");
    expect(list).toHaveBeenCalledWith(db, "CUSTOMER", 1, undefined);
  });

  it("only the owner can cancel an unpaid historical purchase", async () => {
    order.status = "pending_payment";
    const transition = vi.spyOn(orderState, "transition").mockResolvedValue({ ...order, status: "cancelled" });
    await expect(cancelByCustomer(db, order.code, "ANOTHER_CUSTOMER", "reason", { settings: DEFAULT_SETTINGS })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(transition).not.toHaveBeenCalled();
    expect((await cancelByCustomer(db, order.code, "CUSTOMER", "reason", { settings: DEFAULT_SETTINGS })).status).toBe("cancelled");
    expect(transition).toHaveBeenCalledWith(db, order.id, "cancelled", expect.objectContaining({ actor: { type: "customer", id: "CUSTOMER" } }));
  });

  it("accepts an owner's timely return request for a historical purchase", async () => {
    const append = vi.spyOn(orderEvents, "append");
    order.status = "delivered";
    order.deliveredAt = new Date().toISOString();
    const input = { orderCode: order.code, reason: "کالا با توضیحات متفاوت است" };
    await expect(requestReturn(db, order.code, "ANOTHER_CUSTOMER", input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(append).not.toHaveBeenCalled();
    expect((await requestReturn(db, order.code, "CUSTOMER", input)).id).toMatch(/^[0-9A-Z]{26}$/);
    expect(append).toHaveBeenCalledWith(db, order.id, "note", expect.objectContaining({ kind: "return", reason: input.reason }), { type: "customer", id: "CUSTOMER" });
  });
});
