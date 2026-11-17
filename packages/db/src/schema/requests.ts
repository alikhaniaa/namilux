import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, smallint, text, uniqueIndex } from "drizzle-orm/pg-core";
import { staffUsers } from "./auth";
import { products } from "./catalog";
import { createdAt, money, tstz, ulid, updatedAt } from "./columns";
import { customers } from "./customers";
import { questionKind, questionStatus, reviewStatus, salesChannel, stockRequestStatus } from "./enums";
import { orders } from "./orders";

export const backInStockRequests = pgTable(
  "back_in_stock_requests",
  {
    id: ulid("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    phone: text("phone").notNull(),
    customerId: ulid("customer_id").references(() => customers.id),
    status: stockRequestStatus("status").notNull().default("waiting"),
    createdAt: createdAt(),
    notifiedAt: tstz("notified_at"),
  },
  (t) => [
    uniqueIndex("back_in_stock_waiting_uq").on(t.productId, t.phone).where(sql`status = 'waiting'`),
    index("back_in_stock_product_status_idx").on(t.productId, t.status),
    index("back_in_stock_phone_idx").on(t.phone),
    check("back_in_stock_phone_format", sql`phone ~ '^09[0-9]{9}$'`),
  ],
);

export const priceAlerts = pgTable(
  "price_alerts",
  {
    id: ulid("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    phone: text("phone").notNull(),
    customerId: ulid("customer_id").references(() => customers.id),
    targetPrice: money("target_price").notNull(),
    status: stockRequestStatus("status").notNull().default("waiting"),
    createdAt: createdAt(),
    notifiedAt: tstz("notified_at"),
  },
  (t) => [
    uniqueIndex("price_alerts_waiting_uq").on(t.productId, t.phone).where(sql`status = 'waiting'`),
    index("price_alerts_product_status_idx").on(t.productId, t.status),
    check("price_alerts_target_pos", sql`target_price > 0`),
    check("price_alerts_phone_format", sql`phone ~ '^09[0-9]{9}$'`),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: ulid("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    customerId: ulid("customer_id")
      .notNull()
      .references(() => customers.id),
    orderId: ulid("order_id").references(() => orders.id),
    rating: smallint("rating").notNull(),
    title: text("title"),
    body: text("body").notNull(),
    pros: text("pros").array(),
    cons: text("cons").array(),
    isVerifiedPurchase: boolean("is_verified_purchase").notNull().default(false),
    status: reviewStatus("status").notNull().default("pending"),
    adminReply: text("admin_reply"),
    repliedAt: tstz("replied_at"),
    helpfulCount: integer("helpful_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("reviews_product_customer_uq").on(t.productId, t.customerId),
    index("reviews_product_status_created_idx").on(t.productId, t.status, t.createdAt),
    index("reviews_status_created_idx").on(t.status, t.createdAt),
    check("reviews_rating_range", sql`rating between 1 and 5`),
    check("reviews_helpful_nonneg", sql`helpful_count >= 0`),
  ],
);

export const questions = pgTable(
  "questions",
  {
    id: ulid("id").primaryKey(),
    kind: questionKind("kind").notNull().default("question"),
    productId: integer("product_id").references(() => products.id),
    customerId: ulid("customer_id").references(() => customers.id),
    name: text("name"),
    phone: text("phone").notNull(),
    body: text("body").notNull(),
    answer: text("answer"),
    status: questionStatus("status").notNull().default("pending"),
    answeredByStaffId: ulid("answered_by_staff_id").references(() => staffUsers.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    answeredAt: tstz("answered_at"),
    // Which storefront it was sent from (0007). A request from the instalment site is answered with
    // that site's price, and its reply SMS names that site.
    channel: salesChannel("channel").notNull().default("main"),
  },
  (t) => [
    index("questions_status_created_idx").on(t.status, t.createdAt),
    index("questions_kind_status_idx").on(t.kind, t.status),
    index("questions_product_id_idx").on(t.productId),
    check(
      "questions_product_by_kind",
      sql`(kind = 'contact' and product_id is null) or (kind <> 'contact' and product_id is not null)`,
    ),
    check("questions_phone_format", sql`phone ~ '^09[0-9]{9}$'`),
  ],
);
