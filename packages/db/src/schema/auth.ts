import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { bytea, createdAt, tstz, ulid, updatedAt } from "./columns";
import { customers } from "./customers";
import { actorType, otpPurpose } from "./enums";

// ── customer OTP ───────────────────────────────────────────────────────────────────────────────

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: ulid("id").primaryKey(),
    phone: text("phone").notNull(),
    purpose: otpPurpose("purpose").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    expiresAt: tstz("expires_at").notNull(),
    consumedAt: tstz("consumed_at"),
    ip: inet("ip"),
    uaHash: text("ua_hash"),
    createdAt: createdAt(),
  },
  (t) => [
    index("otp_codes_phone_created_idx").on(t.phone, t.createdAt),
    index("otp_codes_expires_at_idx").on(t.expiresAt),
    check("otp_codes_attempts_nonneg", sql`attempts >= 0`),
  ],
);

// ── customer sessions ──────────────────────────────────────────────────────────────────────────

export const sessions = pgTable(
  "sessions",
  {
    id: ulid("id").primaryKey(),
    customerId: ulid("customer_id")
      .notNull()
      .references(() => customers.id),
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    lastSeenAt: tstz("last_seen_at").notNull().defaultNow(),
    expiresAt: tstz("expires_at").notNull(),
    ip: inet("ip"),
    ua: text("ua"),
    revokedAt: tstz("revoked_at"),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
    index("sessions_customer_id_idx").on(t.customerId),
    index("sessions_expires_at_idx").on(t.expiresAt),
  ],
);

// ── staff ──────────────────────────────────────────────────────────────────────────────────────

export const staffRoles = pgTable(
  "staff_roles",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("staff_roles_name_uq").on(t.name)],
);

export const staffUsers = pgTable(
  "staff_users",
  {
    id: ulid("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    totpSecretEnc: text("totp_secret_enc"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    roleId: integer("role_id")
      .notNull()
      .references(() => staffRoles.id),
    isActive: boolean("is_active").notNull().default(true),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: tstz("locked_until"),
    lastLoginAt: tstz("last_login_at"),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("staff_users_email_lower_uq").on(sql`lower(${t.email})`),
    index("staff_users_role_id_idx").on(t.roleId),
  ],
);

export const staffSessions = pgTable(
  "staff_sessions",
  {
    id: ulid("id").primaryKey(),
    staffId: ulid("staff_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAt: createdAt(),
    lastSeenAt: tstz("last_seen_at").notNull().defaultNow(),
    idleExpiresAt: tstz("idle_expires_at").notNull(),
    absoluteExpiresAt: tstz("absolute_expires_at").notNull(),
    sudoUntil: tstz("sudo_until"),
    ip: inet("ip"),
    ua: text("ua"),
  },
  (t) => [
    uniqueIndex("staff_sessions_token_hash_uq").on(t.tokenHash),
    index("staff_sessions_staff_id_idx").on(t.staffId),
    index("staff_sessions_idle_expires_at_idx").on(t.idleExpiresAt),
  ],
);

export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: ulid("id").primaryKey(),
    staffId: ulid("staff_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    credentialId: bytea("credential_id").notNull(),
    publicKey: bytea("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports").array(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("webauthn_credentials_credential_id_uq").on(t.credentialId),
    index("webauthn_credentials_staff_id_idx").on(t.staffId),
  ],
);

// ── audit_log (append-only) ────────────────────────────────────────────────────────────────────

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorType: actorType("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    ip: inet("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entity, t.entityId, t.createdAt),
    index("audit_log_actor_idx").on(t.actorType, t.actorId, t.createdAt),
    index("audit_log_created_at_idx").on(t.createdAt),
  ],
);
