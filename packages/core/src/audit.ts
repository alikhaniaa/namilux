import { and, auditLog, count, desc, eq, gte, lte } from "@namilux/db";
import type { Db } from "@namilux/db";
import { maskPhone } from "./persian/phone";
import type { Actor, AuditRow, JsonObject, JsonValue, Paged } from "./types";

export const MASKED_KEYS = ["password_hash", "passwordHash", "totp_secret_enc", "totpSecretEnc", "token_hash", "tokenHash", "code_hash", "phone", "recipient_phone", "recipientPhone"] as const;

/** The subset of MASKED_KEYS that holds a phone number: masked (0912***0077), not dropped. */
const PHONE_KEYS: ReadonlySet<string> = new Set(["phone", "recipient_phone", "recipientPhone"]);
/** The rest of MASKED_KEYS: dropped entirely - a redacted secret is still a secret's shape. */
const SECRET_KEYS: ReadonlySet<string> = new Set(MASKED_KEYS.filter((k) => !PHONE_KEYS.has(k)));

/** the spec - a diff never grows past this; the viewer shows "__truncated". */
export const MAX_DIFF_BYTES = 64 * 1024;
export const AUDIT_PAGE_SIZE = 50;
const TRUNCATED_KEY = "__truncated";
const MAX_ACTION_LEN = 120;
const MAX_ENTITY_LEN = 80;
const MAX_ENTITY_ID_LEN = 128;
const MAX_DEPTH = 12;

/**
 * DECISION: on top of the MASKED_KEYS column list, any full Iranian mobile number found INSIDE a
 * string value is masked too (the spec "never log phone numbers in full"). A phone reaches a diff
 * through free-text columns (an order note, an address line, a concierge question) far more often
 * than through a column literally named `phone`, and a column list cannot catch those.
 */
const FULL_PHONE_RE = /(?<!\d)(?:\+?98|0098|0)?9\d{9}(?!\d)/gu;

function maskPhonesInText(value: string): string {
  return value.replace(FULL_PHONE_RE, (match) => {
    const digits = match.replace(/\D/gu, "");
    const local = digits.length === 10 ? `0${digits}` : `0${digits.slice(-10)}`;
    return maskPhone(local);
  });
}

/** JSON-safe projection of an arbitrary DB row value; unrepresentable values are dropped. */
function sanitizeValue(value: unknown, depth: number): JsonValue | undefined {
  if (value === null) return null;
  if (depth > MAX_DEPTH) return null;
  switch (typeof value) {
    case "string":
      return maskPhonesInText(value);
    case "number":
      return Number.isFinite(value) ? value : null;
    case "boolean":
      return value;
    case "bigint":
      // A bigserial id survives as a string rather than losing precision through Number().
      return value.toString();
    case "object":
      break;
    case "symbol":
    case "function":
    case "undefined":
      return undefined;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1) ?? null);
  }
  if (value instanceof Map || value instanceof Set) return undefined;
  const out: JsonObject = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.has(key)) continue;
    if (PHONE_KEYS.has(key)) {
      out[key] = typeof raw === "string" ? maskPhone(raw) : null;
      continue;
    }
    const sanitized = sanitizeValue(raw, depth + 1);
    if (sanitized !== undefined) out[key] = sanitized;
  }
  return out;
}

/**
 * DECISION: a non-object side (an array, a primitive) is wrapped as `{ value: … }` instead of being
 * dropped. The contract types both sides as `JsonObject | null`, and a caller that audits a scalar
 * (a status string, a list of ids) must still see what changed.
 */
function toObject(value: unknown): JsonObject | null {
  if (value === undefined || value === null) return null;
  const sanitized = sanitizeValue(value, 0);
  if (sanitized === undefined || sanitized === null) return null;
  if (typeof sanitized === "object" && !Array.isArray(sanitized)) return sanitized;
  return { value: sanitized };
}

/** Structural equality over JSON values (jsonb round-trips reorder object keys). */
function sameJson(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameJson(item, b[i]));
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]));
}

function byteLength(value: unknown): number {
  const json = JSON.stringify(value);
  return json === undefined ? 0 : Buffer.byteLength(json, "utf8");
}

/**
 * Drops the largest changed keys (from both sides in lockstep, so the pair stays comparable) until
 * the serialized diff fits, and flags each surviving side with `__truncated: true`.
 */
function truncatePair(
  before: JsonObject | null,
  after: JsonObject | null,
): { before: JsonObject | null; after: JsonObject | null } {
  if (byteLength({ before, after }) <= MAX_DIFF_BYTES) return { before, after };
  const nextBefore: JsonObject | null = before === null ? null : { ...before, [TRUNCATED_KEY]: true };
  const nextAfter: JsonObject | null = after === null ? null : { ...after, [TRUNCATED_KEY]: true };
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const ordered = keys
    .map((key) => ({ key, size: byteLength(before?.[key]) + byteLength(after?.[key]) }))
    .sort((a, b) => b.size - a.size || (a.key < b.key ? -1 : 1));
  for (const { key } of ordered) {
    if (byteLength({ before: nextBefore, after: nextAfter }) <= MAX_DIFF_BYTES) break;
    if (nextBefore !== null) delete nextBefore[key];
    if (nextAfter !== null) delete nextAfter[key];
  }
  return { before: nextBefore, after: nextAfter };
}

export function jsonDiff(before: unknown, after: unknown): { before: JsonObject | null; after: JsonObject | null } {
  const b = toObject(before);
  const a = toObject(after);
  // Create (no before) / delete (no after): the whole surviving side IS the change.
  if (b === null || a === null) return truncatePair(b, a);
  const outBefore: JsonObject = {};
  const outAfter: JsonObject = {};
  for (const key of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
    const hasBefore = Object.hasOwn(b, key);
    const hasAfter = Object.hasOwn(a, key);
    if (hasBefore && hasAfter && sameJson(b[key], a[key])) continue;
    if (hasBefore) outBefore[key] = b[key] as JsonValue;
    if (hasAfter) outAfter[key] = a[key] as JsonValue;
  }
  return truncatePair(outBefore, outAfter);
}

function clip(value: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > max ? text.slice(0, max) : text;
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u;
const IPV6_RE = /^[0-9a-f:]{2,45}$/iu;

/**
 * DECISION: audit_log.ip follows the same rule as security_events - full for
 * staff (an admin write must be attributable), /24 for everybody else. An address that is neither
 * IPv4 nor IPv6 is stored as NULL rather than risking an `inet` cast error that would abort the
 * caller's transaction and lose the write it was auditing.
 */
export function truncateIp(ip: string | undefined, full: boolean): string | null {
  if (typeof ip !== "string") return null;
  const value = ip.trim();
  if (value === "") return null;
  const v4 = IPV4_RE.exec(value);
  if (v4) {
    const parts = value.split(".").map((part) => Number(part));
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    return full ? value : `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  if (!IPV6_RE.test(value) || !value.includes(":")) return null;
  if (full) return value;
  const groups = value.split(":");
  if (groups.length < 4 || groups.slice(0, 3).some((g) => g === "")) return null;
  return `${groups[0]}:${groups[1]}:${groups[2]}::/48`;
}

function parseDate(value: string | undefined): Date | null {
  if (typeof value !== "string" || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clampPage(page: number | undefined): number {
  if (typeof page !== "number" || !Number.isFinite(page)) return 1;
  return Math.max(1, Math.trunc(page));
}

type AuditRowSource = {
  id: number;
  actorType: Actor["type"];
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  beforeJson: unknown;
  afterJson: unknown;
  ip: string | null;
  createdAt: Date;
};

function toAuditRow(row: AuditRowSource): AuditRow {
  const actor: Actor = { type: row.actorType, id: row.actorId };
  if (row.ip !== null) actor.ip = row.ip;
  return {
    id: row.id,
    actor,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    before: row.beforeJson,
    after: row.afterJson,
    createdAt: row.createdAt.toISOString(),
  };
}

export const audit = {
  async log(
    db: Db,
    actor: Actor,
    action: string,
    entity: string,
    entityId: string,
    before?: unknown,
    after?: unknown,
  ): Promise<void> {
    const diff = jsonDiff(before, after);
    await db.insert(auditLog).values({
      actorType: actor.type,
      // A "system"/"worker" actor has no id: the column is nullable by design.
      actorId: actor.id,
      action: clip(action, MAX_ACTION_LEN),
      entity: clip(entity, MAX_ENTITY_LEN),
      entityId: clip(entityId, MAX_ENTITY_ID_LEN),
      beforeJson: diff.before,
      afterJson: diff.after,
      ip: truncateIp(actor.ip, actor.type === "staff"),
    });
  },

  async list(
    db: Db,
    q: { entity?: string; entityId?: string; actorId?: string; from?: string; to?: string; page?: number },
  ): Promise<Paged<AuditRow>> {
    const page = clampPage(q.page);
    const conditions = [];
    if (typeof q.entity === "string" && q.entity !== "") conditions.push(eq(auditLog.entity, q.entity));
    if (typeof q.entityId === "string" && q.entityId !== "") conditions.push(eq(auditLog.entityId, q.entityId));
    if (typeof q.actorId === "string" && q.actorId !== "") conditions.push(eq(auditLog.actorId, q.actorId));
    // DECISION: an unparseable `from`/`to` drops that bound instead of throwing - ../errors is not
    // in this module's dependency list, and a viewer filter must never 500 the audit page.
    const from = parseDate(q.from);
    if (from !== null) conditions.push(gte(auditLog.createdAt, from));
    const to = parseDate(q.to);
    if (to !== null) conditions.push(lte(auditLog.createdAt, to));
    const where = conditions.length === 0 ? undefined : and(...conditions);

    const rows = await db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(AUDIT_PAGE_SIZE)
      .offset((page - 1) * AUDIT_PAGE_SIZE);
    const totals = await db.select({ n: count() }).from(auditLog).where(where);

    return {
      items: rows.map((row) => toAuditRow(row)),
      total: totals[0]?.n ?? 0,
      page,
      pageSize: AUDIT_PAGE_SIZE,
    };
  },
};
