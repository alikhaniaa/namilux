import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createdAt, money, tstz, ulid, updatedAt } from "./columns";
import { customerTier, gender } from "./enums";

export const customers = pgTable(
  "customers",
  {
    id: ulid("id").primaryKey(),
    phone: text("phone").notNull(),
    phoneVerifiedAt: tstz("phone_verified_at"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    birthday: date("birthday", { mode: "string" }),
    gender: gender("gender"),
    tier: customerTier("tier").notNull().default("member"),
    pointsBalance: integer("points_balance").notNull().default(0),
    referralCode: text("referral_code").notNull(),
    referredById: ulid("referred_by_id").references((): AnyPgColumn => customers.id),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    isBlocked: boolean("is_blocked").notNull().default(false),
    blockReason: text("block_reason"),
    adminNote: text("admin_note"),
    lastLoginAt: tstz("last_login_at"),
    ordersCount: integer("orders_count").notNull().default(0),
    lifetimeSpend: money("lifetime_spend").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("customers_phone_uq").on(t.phone),
    uniqueIndex("customers_referral_code_uq").on(t.referralCode),
    index("customers_tier_idx").on(t.tier),
    index("customers_created_at_idx").on(t.createdAt),
    index("customers_referred_by_id_idx").on(t.referredById),
    check("customers_phone_format", sql`phone ~ '^(09[0-9]{9}|del_[0-9A-HJKMNP-TV-Z]{26})$'`),
    check("customers_lifetime_spend_nonneg", sql`lifetime_spend >= 0`),
    check("customers_orders_count_nonneg", sql`orders_count >= 0`),
  ],
);

export const addresses = pgTable(
  "addresses",
  {
    id: ulid("id").primaryKey(),
    customerId: ulid("customer_id")
      .notNull()
      .references(() => customers.id),
    label: text("label").notNull(),
    recipientName: text("recipient_name").notNull(),
    recipientPhone: text("recipient_phone").notNull(),
    province: text("province").notNull(),
    city: text("city").notNull(),
    address: text("address").notNull(),
    plaque: text("plaque"),
    unit: text("unit"),
    postcode: text("postcode").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    geoLat: numeric("geo_lat"),
    geoLng: numeric("geo_lng"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("addresses_customer_id_idx").on(t.customerId),
    uniqueIndex("addresses_default_uq").on(t.customerId).where(sql`is_default`),
    check("addresses_postcode_10_digits", sql`postcode ~ '^[0-9]{10}$'`),
  ],
);
