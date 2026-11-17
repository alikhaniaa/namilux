import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createdAt, money, tstz, ulid, updatedAt } from "./columns";
import { jobStatus, smsStatus, uaClass } from "./enums";

// ── settings ───────────────────────────────────────────────────────────────────────────────────

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  valueJson: jsonb("value_json").notNull(),
  updatedBy: text("updated_by"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── jobs ───────────────────────────────────────────────────────────────────────────────────────

export const jobs = pgTable(
  "jobs",
  {
    id: ulid("id").primaryKey(),
    type: text("type").notNull(),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatus("status").notNull().default("queued"),
    runAt: tstz("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    lockedBy: text("locked_by"),
    lockedAt: tstz("locked_at"),
    uniqueKey: text("unique_key"),
    createdAt: createdAt(),
    finishedAt: tstz("finished_at"),
  },
  (t) => [
    index("jobs_status_run_at_idx").on(t.status, t.runAt),
    index("jobs_type_status_idx").on(t.type, t.status),
    index("jobs_running_locked_at_idx").on(t.lockedAt).where(sql`status = 'running'`),
    uniqueIndex("jobs_unique_key_uq").on(t.uniqueKey).where(sql`unique_key is not null`),
    check("jobs_attempts_nonneg", sql`attempts >= 0 and max_attempts >= 1`),
  ],
);

// ── sms_log ────────────────────────────────────────────────────────────────────────────────────

export const smsLog = pgTable(
  "sms_log",
  {
    id: ulid("id").primaryKey(),
    toMasked: text("to_masked").notNull(),
    toHash: text("to_hash").notNull(),
    template: text("template").notNull(),
    provider: text("provider").notNull(),
    status: smsStatus("status").notNull().default("queued"),
    providerRef: text("provider_ref"),
    cost: money("cost"),
    error: text("error"),
    orderId: ulid("order_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("sms_log_created_at_idx").on(t.createdAt),
    index("sms_log_to_hash_created_idx").on(t.toHash, t.createdAt),
    index("sms_log_order_id_idx").on(t.orderId),
    index("sms_log_template_created_idx").on(t.template, t.createdAt),
    check("sms_log_to_masked_no_full_number", sql`to_masked !~ '^09[0-9]{9}$'`),
  ],
);

// ── rate_limits (durable OTP/phone quotas) ─────────────────────────────────────────────────────

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    windowStart: tstz("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    index("rate_limits_window_start_idx").on(t.windowStart),
    check("rate_limits_count_nonneg", sql`count >= 0`),
  ],
);

// ── security_events ────────────────────────────────────────────────────────────────────────────

export const securityEvents = pgTable(
  "security_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull(),
    ip: inet("ip"),
    actor: text("actor"),
    detailJson: jsonb("detail_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("security_events_kind_created_idx").on(t.kind, t.createdAt),
    index("security_events_created_at_idx").on(t.createdAt),
  ],
);

// ── events (first-party analytics; PARTITION BY RANGE (ts) - see header) ───────────────────────

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).notNull(),
    ts: tstz("ts").notNull().defaultNow(),
    type: text("type").notNull(),
    path: text("path").notNull(),
    ref: text("ref"),
    productId: integer("product_id"),
    sessionHash: text("session_hash").notNull(),
    uaClass: uaClass("ua_class").notNull(),
    propsJson: jsonb("props_json").$type<Record<string, unknown>>(),
  },
  (t) => [
    primaryKey({ name: "events_pk", columns: [t.id, t.ts] }),
    index("events_ts_idx").on(t.ts),
    index("events_type_ts_idx").on(t.type, t.ts),
    index("events_type_path_ts_idx").on(t.type, t.path, t.ts),
    index("events_product_ts_idx").on(t.productId, t.ts).where(sql`product_id is not null`),
  ],
);

// ── metrics_daily ──────────────────────────────────────────────────────────────────────────────

export const metricsDaily = pgTable(
  "metrics_daily",
  {
    day: date("day", { mode: "string" }).notNull(),
    metric: text("metric").notNull(),
    dim: text("dim").notNull().default(""),
    value: numeric("value").notNull().default("0"),
  },
  (t) => [
    primaryKey({ name: "metrics_daily_pk", columns: [t.day, t.metric, t.dim] }),
    index("metrics_daily_metric_day_idx").on(t.metric, t.day),
  ],
);
