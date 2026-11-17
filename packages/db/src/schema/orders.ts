import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffUsers } from "./auth";
import { products } from "./catalog";
import { createdAt, money, tstz, ulid, updatedAt } from "./columns";
import { customers } from "./customers";
import {
  actorType,
  movementReason,
  orderSource,
  orderStatus,
  paymentStatus,
  refundStatus,
  salesChannel,
  shipmentCarrier,
  shipmentStatus,
} from "./enums";

// ── jsonb shapes ───────────────────────────────────────────────────────────────────────────────

/** orders.address_snapshot_json - copied from addresses at placement */
export type AddressSnapshot = {
  recipientName: string;
  recipientPhone: string;
  province: string;
  city: string;
  address: string;
  plaque?: string | null;
  unit?: string | null;
  postcode: string;
};

/** orders.shipping_snapshot_json - the spec "(name, eta)" */
export type ShippingSnapshot = {
  key: string;
  name: string;
  etaMinDays: number;
  etaMaxDays: number;
  cost: number;
};

/** orders.utm_json */
export type UtmSnapshot = {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
  ref?: string;
};

/** order_events.payload_json - free-form per event type; core defines the per-type shapes */
export type OrderEventPayload = Record<string, unknown>;

// ── orders ─────────────────────────────────────────────────────────────────────────────────────

export const orders = pgTable(
  "orders",
  {
    id: ulid("id").primaryKey(),
    code: text("code").notNull(),
    invoiceYear: smallint("invoice_year"),
    invoiceNo: integer("invoice_no"),
    customerId: ulid("customer_id").references(() => customers.id),
    phone: text("phone").notNull(),
    email: text("email"),
    status: orderStatus("status").notNull().default("draft"),
    source: orderSource("source").notNull().default("web"),
    // Which storefront placed it - the price basis and the gateway that may settle it. NOT the same
    // thing as `channel_ref`, which is the external reference of a `source` like instagram.
    channel: salesChannel("channel").notNull().default("main"),
    channelRef: text("channel_ref"),
    subtotal: money("subtotal").notNull().default(0),
    discountTotal: money("discount_total").notNull().default(0),
    shippingTotal: money("shipping_total").notNull().default(0),
    pointsDiscount: money("points_discount").notNull().default(0),
    grandTotal: money("grand_total").notNull().default(0),
    couponId: integer("coupon_id"),
    couponCode: text("coupon_code"),
    pointsRedeemed: integer("points_redeemed").notNull().default(0),
    pointsEarned: integer("points_earned").notNull().default(0),
    shippingMethodKey: text("shipping_method_key"),
    shippingSnapshotJson: jsonb("shipping_snapshot_json").$type<ShippingSnapshot>(),
    addressSnapshotJson: jsonb("address_snapshot_json").$type<AddressSnapshot>(),
    customerNote: text("customer_note"),
    adminNote: text("admin_note"),
    giftMessage: text("gift_message"),
    isGift: boolean("is_gift").notNull().default(false),
    ip: inet("ip"),
    ua: text("ua"),
    utmJson: jsonb("utm_json").$type<UtmSnapshot>(),
    placedAt: tstz("placed_at"),
    paidAt: tstz("paid_at"),
    shippedAt: tstz("shipped_at"),
    deliveredAt: tstz("delivered_at"),
    cancelledAt: tstz("cancelled_at"),
    cancelReason: text("cancel_reason"),
    expiresAt: tstz("expires_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_code_uq").on(t.code),
    uniqueIndex("orders_invoice_uq").on(t.invoiceYear, t.invoiceNo).where(sql`invoice_no is not null`),
    index("orders_customer_placed_idx").on(t.customerId, t.placedAt.desc()),
    index("orders_channel_placed_idx").on(t.channel, t.placedAt.desc()),
    index("orders_status_idx").on(t.status),
    index("orders_phone_idx").on(t.phone),
    index("orders_placed_at_idx").on(t.placedAt),
    index("orders_pending_expires_idx").on(t.expiresAt).where(sql`status = 'pending_payment'`),
    check("orders_code_format", sql`code ~ '^NL-[A-Z0-9]{5}$'`),
    check(
      "orders_terms_nonneg",
      sql`subtotal >= 0 and discount_total >= 0 and shipping_total >= 0 and points_discount >= 0 and grand_total >= 0`,
    ),
    check(
      "orders_grand_total_formula",
      sql`grand_total = subtotal - discount_total - points_discount + shipping_total`,
    ),
    check("orders_points_nonneg", sql`points_redeemed >= 0 and points_earned >= 0`),
    check(
      "orders_invoice_pair",
      sql`(invoice_no is null and invoice_year is null) or (invoice_no is not null and invoice_year is not null)`,
    ),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: ulid("id").primaryKey(),
    orderId: ulid("order_id")
      .notNull()
      .references(() => orders.id),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    name: text("name").notNull(),
    sku: text("sku"),
    modelCode: text("model_code"),
    colorName: text("color_name"),
    imageKey: text("image_key"),
    unitPrice: money("unit_price").notNull(),
    compareAtPrice: money("compare_at_price"),
    qty: integer("qty").notNull(),
    lineTotal: money("line_total").notNull(),
    warrantyMonths: integer("warranty_months"),
  },
  (t) => [
    index("order_items_order_id_idx").on(t.orderId),
    index("order_items_product_id_idx").on(t.productId),
    check("order_items_qty_pos", sql`qty >= 1`),
    check("order_items_unit_price_pos", sql`unit_price > 0`),
    check("order_items_line_total_formula", sql`line_total = unit_price * qty`),
  ],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orderId: ulid("order_id")
      .notNull()
      .references(() => orders.id),
    type: text("type").notNull(),
    payloadJson: jsonb("payload_json").$type<OrderEventPayload>().notNull().default({}),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id"),
    createdAt: createdAt(),
  },
  (t) => [index("order_events_order_created_idx").on(t.orderId, t.createdAt)],
);

// ── payments & refunds ─────────────────────────────────────────────────────────────────────────

export const payments = pgTable(
  "payments",
  {
    id: ulid("id").primaryKey(),
    orderId: ulid("order_id")
      .notNull()
      .references(() => orders.id),
    driver: text("driver").notNull(),
    amount: money("amount").notNull(),
    status: paymentStatus("status").notNull().default("initiated"),
    authority: text("authority"),
    refId: text("ref_id"),
    cardPanMasked: text("card_pan_masked"),
    fee: money("fee"),
    rawJson: jsonb("raw_json"),
    createdAt: createdAt(),
    verifiedAt: tstz("verified_at"),
  },
  (t) => [
    uniqueIndex("payments_authority_uq").on(t.authority).where(sql`authority is not null`),
    uniqueIndex("payments_one_succeeded_per_order_uq").on(t.orderId).where(sql`status = 'succeeded'`),
    index("payments_order_id_idx").on(t.orderId),
    index("payments_status_created_idx").on(t.status, t.createdAt),
    check("payments_amount_pos", sql`amount > 0`),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: ulid("id").primaryKey(),
    paymentId: ulid("payment_id")
      .notNull()
      .references(() => payments.id),
    orderId: ulid("order_id")
      .notNull()
      .references(() => orders.id),
    amount: money("amount").notNull(),
    reason: text("reason").notNull(),
    status: refundStatus("status").notNull().default("requested"),
    providerRef: text("provider_ref"),
    byStaffId: ulid("by_staff_id").references(() => staffUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    doneAt: tstz("done_at"),
  },
  (t) => [
    index("refunds_order_id_idx").on(t.orderId),
    index("refunds_payment_id_idx").on(t.paymentId),
    check("refunds_amount_pos", sql`amount > 0`),
  ],
);

// ── shipments ──────────────────────────────────────────────────────────────────────────────────

export const shipments = pgTable(
  "shipments",
  {
    id: ulid("id").primaryKey(),
    orderId: ulid("order_id")
      .notNull()
      .references(() => orders.id),
    carrier: shipmentCarrier("carrier").notNull(),
    trackingCode: text("tracking_code"),
    trackingUrl: text("tracking_url"),
    status: shipmentStatus("status").notNull().default("preparing"),
    cost: money("cost"),
    shippedAt: tstz("shipped_at"),
    deliveredAt: tstz("delivered_at"),
    note: text("note"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("shipments_order_id_idx").on(t.orderId)],
);

// ── inventory ──────────────────────────────────────────────────────────────────────────────────

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    delta: integer("delta").notNull(),
    reason: movementReason("reason").notNull(),
    orderId: ulid("order_id").references(() => orders.id),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("inventory_movements_product_created_idx").on(t.productId, t.createdAt),
    index("inventory_movements_order_id_idx").on(t.orderId),
    check("inventory_movements_delta_nonzero", sql`delta <> 0`),
  ],
);

export const inventoryReservations = pgTable(
  "inventory_reservations",
  {
    id: ulid("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    orderId: ulid("order_id")
      .notNull()
      .references(() => orders.id),
    qty: integer("qty").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    releasedAt: tstz("released_at"),
    consumedAt: tstz("consumed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("inventory_reservations_active_product_idx")
      .on(t.productId)
      .where(sql`released_at is null and consumed_at is null`),
    index("inventory_reservations_active_expires_idx")
      .on(t.expiresAt)
      .where(sql`released_at is null and consumed_at is null`),
    index("inventory_reservations_order_id_idx").on(t.orderId),
    check("inventory_reservations_qty_pos", sql`qty >= 1`),
    check(
      "inventory_reservations_single_outcome",
      sql`not (released_at is not null and consumed_at is not null)`,
    ),
  ],
);
