import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { staffUsers } from "./auth";
import { products } from "./catalog";
import { createdAt, money, tstz, ulid, updatedAt } from "./columns";
import { customers } from "./customers";
import { couponKind, salesChannel, shippingKind } from "./enums";
import { orders } from "./orders";

// ── jsonb shapes ───────────────────────────────────────────────────────────────────────────────

/** shipping_methods.rate_json - the spec */
export type ShippingRate = {
  flat?: number;
  byProvince?: Record<string, number>;
  freeAbove?: number;
};

/** coupons.applies_json / excludes_json - the spec */
export type CouponScope = {
  brandIds?: number[];
  categoryIds?: number[];
  collectionIds?: number[];
  productIds?: number[];
};

// ── carts & wishlists (logged-in customers only) ───────────────────────────────────────────────

export const carts = pgTable(
  "carts",
  {
    id: ulid("id").primaryKey(),
    customerId: ulid("customer_id")
      .notNull()
      .references(() => customers.id),
    // One cart per customer PER STOREFRONT: the two sites price the same product differently, so a
    // basket built on one must not be spent on the other.
    channel: salesChannel("channel").notNull().default("main"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("carts_customer_channel_uq").on(t.customerId, t.channel)],
);

export const cartItems = pgTable(
  "cart_items",
  {
    cartId: ulid("cart_id")
      .notNull()
      .references(() => carts.id, { onDelete: "cascade" }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    qty: integer("qty").notNull().default(1),
    addedAt: tstz("added_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.cartId, t.productId] }),
    index("cart_items_product_id_idx").on(t.productId),
    check("cart_items_qty_pos", sql`qty >= 1`),
  ],
);

export const wishlists = pgTable(
  "wishlists",
  {
    customerId: ulid("customer_id")
      .notNull()
      .references(() => customers.id),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.customerId, t.productId] }),
    index("wishlists_product_id_idx").on(t.productId),
  ],
);

// ── shipping methods ───────────────────────────────────────────────────────────────────────────

export const shippingMethods = pgTable(
  "shipping_methods",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    kind: shippingKind("kind").notNull(),
    rateJson: jsonb("rate_json").$type<ShippingRate>().notNull().default({}),
    provinces: text("provinces").array(),
    etaMinDays: integer("eta_min_days").notNull().default(0),
    etaMaxDays: integer("eta_max_days").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("shipping_methods_key_uq").on(t.key),
    index("shipping_methods_active_sort_idx").on(t.isActive, t.sort),
    check("shipping_methods_eta_valid", sql`eta_min_days >= 0 and eta_max_days >= eta_min_days`),
  ],
);

// ── coupons ────────────────────────────────────────────────────────────────────────────────────

export const coupons = pgTable(
  "coupons",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull(),
    kind: couponKind("kind").notNull(),
    value: money("value").notNull().default(0),
    minSubtotal: money("min_subtotal").notNull().default(0),
    maxDiscount: money("max_discount"),
    startsAt: tstz("starts_at"),
    endsAt: tstz("ends_at"),
    usageLimit: integer("usage_limit"),
    usagePerCustomer: integer("usage_per_customer").notNull().default(1),
    firstOrderOnly: boolean("first_order_only").notNull().default(false),
    customerId: ulid("customer_id").references(() => customers.id),
    appliesJson: jsonb("applies_json").$type<CouponScope>().notNull().default({}),
    excludesJson: jsonb("excludes_json").$type<CouponScope>().notNull().default({}),
    stackableWithPoints: boolean("stackable_with_points").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdByStaffId: ulid("created_by_staff_id").references(() => staffUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("coupons_code_uq").on(t.code),
    index("coupons_active_ends_idx").on(t.isActive, t.endsAt),
    index("coupons_customer_id_idx").on(t.customerId),
    check("coupons_code_upper", sql`code = upper(code)`),
    check("coupons_value_nonneg", sql`value >= 0`),
    check("coupons_min_subtotal_nonneg", sql`min_subtotal >= 0`),
    check("coupons_usage_per_customer_pos", sql`usage_per_customer >= 1`),
    check("coupons_window_valid", sql`starts_at is null or ends_at is null or starts_at < ends_at`),
  ],
);

export const couponRedemptions = pgTable(
  "coupon_redemptions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    couponId: integer("coupon_id")
      .notNull()
      .references(() => coupons.id),
    orderId: ulid("order_id")
      .notNull()
      .references(() => orders.id),
    customerId: ulid("customer_id").references(() => customers.id),
    amount: money("amount").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("coupon_redemptions_order_id_uq").on(t.orderId),
    index("coupon_redemptions_coupon_id_idx").on(t.couponId),
    index("coupon_redemptions_customer_coupon_idx").on(t.customerId, t.couponId),
    check("coupon_redemptions_amount_nonneg", sql`amount >= 0`),
  ],
);
