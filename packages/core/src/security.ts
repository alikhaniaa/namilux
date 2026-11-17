import { and, count, desc, eq, gte, lte, securityEvents } from "@namilux/db";
import type { Db } from "@namilux/db";
import { SECURITY_EVENT_KINDS } from "./constants";
import type { SecurityEventKind } from "./constants";
import { jobs } from "./jobs";
import { maskPhone } from "./persian/phone";
import type { JsonObject, JsonValue, Paged, SecurityEvent } from "./types";

/**
 * DECISION: the contract comment names eight alert triggers, but `ALERT_KINDS` is typed
 * `readonly SecurityEventKind[]` and SECURITY_EVENT_KINDS (constants.ts, DONE) has no
 * "order.spike", "notfound.spike" or "sms.budget" label - those three are threshold detections a
 * scheduled job raises, not events a request path records, so they cannot be listed here
 * without inventing enum labels. "otp.breaker" is expanded into the two labels that exist.
 */
export const ALERT_KINDS: readonly SecurityEventKind[] = [
  "otp.breaker.captcha",
  "otp.breaker.pause",
  "staff.login.failed",
  "staff.login.new_ip",
  "callback.forged",
  "upload.rejected",
];

/** rules: at most one Telegram message per kind per 10 minutes. */
export const ALERT_WINDOW_MIN = 10;

/**
 * How many events of a kind must land inside ALERT_WINDOW_MIN before the owner is told. the spec
 * asks for "5+ failed logins"; every other alert kind fires on the first event.
 */
export const ALERT_THRESHOLDS: Partial<Record<SecurityEventKind, number>> = { "staff.login.failed": 5 };

export const SECURITY_EVENTS_PAGE_SIZE = 50;
const MAX_DETAIL_BYTES = 8 * 1024;
const MAX_DETAIL_DEPTH = 6;
const MAX_STRING_LEN = 500;
const MAX_ACTOR_LEN = 128;

/**
 * Free-form detail objects are written by every request path, so the scrub is a NAME rule, not a
 * list: anything whose key smells of a credential is dropped outright (the spec "never log OTP codes,
 * tokens, card PANs, addresses, request bodies").
 */
const SENSITIVE_KEY_RE =
  /(pass(word)?|secret|token|otp|^code$|_code$|hash|pepper|salt|authorization|cookie|session|pan|cvv|card|address|postcode|body|payload)/iu;
const PHONE_KEY_RE = /phone|mobile|msisdn/iu;
/** A full Iranian mobile anywhere inside a string value is masked. */
const FULL_PHONE_RE = /(?<!\d)(?:\+?98|0098|0)?9\d{9}(?!\d)/gu;

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u;
const IPV6_RE = /^[0-9a-f:]{2,45}$/iu;

const KINDS: ReadonlySet<string> = new Set(SECURITY_EVENT_KINDS);
const ALERT_SET: ReadonlySet<string> = new Set(ALERT_KINDS);

/**
 * DECISION: core must not import @namilux/config (the spec boundaries and this module's dependency list),
 * so "is Telegram configured" is read straight from process.env - presence only, the values are
 * never read, logged or stored. env.ts already guarantees the pair is set together.
 */
function telegramConfigured(): boolean {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  return typeof token === "string" && token !== "" && typeof chat === "string" && chat !== "";
}

/**
 * DECISION: `packages/core` has no logger (pino belongs to the apps, the spec), so the best-effort
 * failure path warns on the console with the kind only - never the detail, never the error's
 * payload - which is what "never throw into the request path" needs to be observable at all.
 */
function warnSecurity(message: string): void {
  // eslint-disable-next-line no-console -- see the DECISION above: core has no logger and this path must not throw
  console.warn(`[security] ${message}`);
}

function maskPhonesInText(value: string): string {
  return value.replace(FULL_PHONE_RE, (match) => {
    const digits = match.replace(/\D/gu, "");
    const local = digits.length === 10 ? `0${digits}` : `0${digits.slice(-10)}`;
    return maskPhone(local);
  });
}

function scrubValue(value: unknown, depth: number): JsonValue | undefined {
  if (value === null) return null;
  if (depth > MAX_DETAIL_DEPTH) return null;
  switch (typeof value) {
    case "string": {
      const masked = maskPhonesInText(value);
      return masked.length > MAX_STRING_LEN ? masked.slice(0, MAX_STRING_LEN) : masked;
    }
    case "number":
      return Number.isFinite(value) ? value : null;
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "object":
      break;
    case "symbol":
    case "function":
    case "undefined":
      return undefined;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1) ?? null);
  const out: JsonObject = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(key)) continue;
    if (PHONE_KEY_RE.test(key)) {
      out[key] = typeof raw === "string" ? maskPhone(raw) : null;
      continue;
    }
    const scrubbed = scrubValue(raw, depth + 1);
    if (scrubbed !== undefined) out[key] = scrubbed;
  }
  return out;
}

export function scrubDetail(detail: JsonObject): JsonObject {
  const scrubbed = scrubValue(detail, 0);
  const out: JsonObject =
    scrubbed !== null && typeof scrubbed === "object" && !Array.isArray(scrubbed) ? scrubbed : {};
  const json = JSON.stringify(out) ?? "{}";
  if (Buffer.byteLength(json, "utf8") <= MAX_DETAIL_BYTES) return out;
  // An oversized detail is a request body in disguise: keep the keys, drop the values.
  return { __truncated: true, keys: Object.keys(out).slice(0, 50) };
}

/**
 * DECISION: "full for staff" is decided from the kind prefix (`staff.*`). `event()` receives no
 * actor TYPE - only an opaque actor string - and an admin action must stay attributable while a
 * customer's address is truncated to /24. An address that parses as neither IPv4 nor IPv6 is
 * stored as NULL so a hostile `X-Forwarded-For` can never break the `inet` cast.
 */
export function normalizeEventIp(ip: string | undefined, full: boolean): string | null {
  if (typeof ip !== "string") return null;
  const value = ip.trim();
  if (value === "") return null;
  if (IPV4_RE.test(value)) {
    const parts = value.split(".").map((part) => Number(part));
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    return full ? value : `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  if (!IPV6_RE.test(value) || !value.includes(":")) return null;
  if (full) return value;
  const groups = value.split(":");
  if (groups.length < 4 || groups.slice(0, 3).some((group) => group === "")) return null;
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

type SecurityEventRowSource = {
  id: number;
  kind: string;
  ip: string | null;
  actor: string | null;
  detailJson: unknown;
  createdAt: Date;
};

function toSecurityEvent(row: SecurityEventRowSource): SecurityEvent {
  const detail =
    row.detailJson !== null && typeof row.detailJson === "object" && !Array.isArray(row.detailJson)
      ? (row.detailJson as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    kind: row.kind,
    ip: row.ip,
    actor: row.actor,
    detail,
    createdAt: row.createdAt.toISOString(),
  };
}

export const security = {
  async event(
    db: Db,
    kind: SecurityEventKind,
    detail: JsonObject,
    ip?: string,
    actor?: string,
  ): Promise<void> {
    try {
      if (!KINDS.has(kind)) {
        warnSecurity(`unknown kind ${JSON.stringify(kind)} — not recorded`);
        return;
      }
      const safeDetail = scrubDetail(detail);
      const safeIp = normalizeEventIp(ip, kind.startsWith("staff."));
      const safeActor =
        typeof actor === "string" && actor !== "" ? maskPhonesInText(actor).slice(0, MAX_ACTOR_LEN) : null;

      await db.insert(securityEvents).values({
        kind,
        ip: safeIp,
        actor: safeActor,
        detailJson: safeDetail,
      });

      if (!ALERT_SET.has(kind)) return;
      if (!telegramConfigured()) return;

      /**
       * DECISION: the "one message per kind per 10 minutes" limit is decided from the sliding
       * count of security_events, not from the job's uniqueKey alone. `jobs.enqueue` recycles a
       * uniqueKey whose job already finished (its EDGE CASE), so a bucketed key on its own would
       * let a second alert through inside the same window. Alerting exactly when the count REACHES
       * the threshold gives one message per window; the bucketed uniqueKey stays as a second belt.
       */
      const threshold = ALERT_THRESHOLDS[kind] ?? 1;
      const recent = await security.countRecent(db, kind, ALERT_WINDOW_MIN);
      if (recent !== threshold) return;

      const bucket = Math.floor(Date.now() / (ALERT_WINDOW_MIN * 60_000));
      await jobs.enqueue(
        db,
        "telegram.notify",
        {
          kind: "security.alert",
          event: kind,
          count: recent,
          ip: safeIp,
          actor: safeActor,
          detail: safeDetail,
        },
        { uniqueKey: `security.alert:${kind}:${bucket}` },
      );
    } catch (err: unknown) {
      // EDGE CASE: never throw into the request path - a failed audit must not fail a login.
      warnSecurity(`could not record ${kind}: ${err instanceof Error ? err.name : "unknown error"}`);
    }
  },

  async list(
    db: Db,
    q: { kind?: SecurityEventKind; from?: string; to?: string; page?: number },
  ): Promise<Paged<SecurityEvent>> {
    const page = clampPage(q.page);
    const conditions = [];
    if (q.kind !== undefined) conditions.push(eq(securityEvents.kind, q.kind));
    // An unparseable bound drops that filter rather than 500-ing the security viewer.
    const from = parseDate(q.from);
    if (from !== null) conditions.push(gte(securityEvents.createdAt, from));
    const to = parseDate(q.to);
    if (to !== null) conditions.push(lte(securityEvents.createdAt, to));
    const where = conditions.length === 0 ? undefined : and(...conditions);

    const rows = await db
      .select()
      .from(securityEvents)
      .where(where)
      .orderBy(desc(securityEvents.createdAt), desc(securityEvents.id))
      .limit(SECURITY_EVENTS_PAGE_SIZE)
      .offset((page - 1) * SECURITY_EVENTS_PAGE_SIZE);
    const totals = await db.select({ n: count() }).from(securityEvents).where(where);

    return {
      items: rows.map((row) => toSecurityEvent(row as SecurityEventRowSource)),
      total: totals[0]?.n ?? 0,
      page,
      pageSize: SECURITY_EVENTS_PAGE_SIZE,
    };
  },

  async countRecent(db: Db, kind: SecurityEventKind, minutes: number): Promise<number> {
    const span = Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
    const since = new Date(Date.now() - span * 60_000);
    const rows = await db
      .select({ n: count() })
      .from(securityEvents)
      .where(and(eq(securityEvents.kind, kind), gte(securityEvents.createdAt, since)));
    return rows[0]?.n ?? 0;
  },
};
