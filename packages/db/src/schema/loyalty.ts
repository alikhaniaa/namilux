import { sql } from "drizzle-orm";
import { bigserial, check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, tstz, ulid } from "./columns";
import { customers } from "./customers";
import { loyaltyReason, referralStatus } from "./enums";
import { orders } from "./orders";

export const loyaltyLedger = pgTable(
  "loyalty_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    customerId: ulid("customer_id")
      .notNull()
      .references(() => customers.id),
    delta: integer("delta").notNull(),
    reason: loyaltyReason("reason").notNull(),
    orderId: ulid("order_id").references(() => orders.id),
    expiresAt: tstz("expires_at"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [
    index("loyalty_ledger_customer_created_idx").on(t.customerId, t.createdAt),
    index("loyalty_ledger_order_id_idx").on(t.orderId),
    index("loyalty_ledger_expires_at_idx").on(t.expiresAt).where(sql`expires_at is not null`),
    check("loyalty_ledger_delta_nonzero", sql`delta <> 0`),
  ],
);

export const referrals = pgTable(
  "referrals",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    referrerId: ulid("referrer_id")
      .notNull()
      .references(() => customers.id),
    refereeId: ulid("referee_id")
      .notNull()
      .references(() => customers.id),
    status: referralStatus("status").notNull().default("pending"),
    orderId: ulid("order_id").references(() => orders.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("referrals_referee_id_uq").on(t.refereeId),
    index("referrals_referrer_id_idx").on(t.referrerId),
    check("referrals_not_self", sql`referrer_id <> referee_id`),
  ],
);
