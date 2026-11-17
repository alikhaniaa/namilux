import { createHash, randomBytes } from "node:crypto";
import { type Db, and, customers, eq, gt, isNull, sessions as sessionsTable, sql } from "@namilux/db";
// DECISION (M0 step 3): SESSION_COOKIE lives in ../constants and UaClass/SessionUser in ../types;
// this module imports them instead of re-declaring (see src/index.ts rules).
import { SESSION_COOKIE } from "../constants";
import type { UaClass } from "../constants";
import type { SessionUser } from "../types";
import { appError } from "../errors";
import { ulid } from "../ids";
import { ipSlash24 } from "./quota";

const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// DECISION: peppers are read from process.env, which the app's env loader (@namilux/config webEnv/
// adminEnv/workerEnv) has already validated as 64-hex at boot. Reading process.env keeps core
// app-agnostic (security.ts reads TELEGRAM_* the same way); a missing pepper throws INTERNAL loudly.
function sessionPepper(): string {
  const p = process.env.SESSION_PEPPER;
  if (typeof p !== "string" || p === "") {
    throw appError("INTERNAL", { details: "SESSION_PEPPER is not configured" });
  }
  return p;
}

function toIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

export { SESSION_COOKIE };
export const SESSION_TTL_MS = 180 * 86_400_000;
export const SESSION_TOUCH_MS = 3_600_000;
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: 15_552_000,
} as const;

export type SessionInfo = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  ipMasked: string;
  uaClass: UaClass;
  current: boolean;
};

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string, pepper: string): string {
  return createHash("sha256").update(token + pepper).digest("hex");
}

export async function createSession(
  db: Db,
  customerId: string,
  meta: { ip: string; ua: string },
): Promise<{ token: string; expiresAt: Date }> {
  const rows = await db
    .select({ isBlocked: customers.isBlocked })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  const c = rows[0];
  if (c === undefined) throw appError("NOT_FOUND", { fa: "کاربر پیدا نشد" });
  if (c.isBlocked) throw appError("FORBIDDEN", { fa: "حساب شما مسدود شده است؛ با پشتیبانی تماس بگیرید" });

  const token = newSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessionsTable).values({
    id: ulid(),
    customerId,
    tokenHash: hashToken(token, sessionPepper()),
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    // DECISION (M8 browser check): inet column - an unknown client address is NULL, never "".
    ip: meta.ip === "" ? null : meta.ip,
    ua: meta.ua.slice(0, 512),
  });
  return { token, expiresAt };
}

export async function resolveSession(db: Db, token: string | undefined): Promise<SessionUser | null> {
  if (token === undefined || !SESSION_TOKEN_RE.test(token)) return null;
  const tokenHash = hashToken(token, sessionPepper());
  const rows = await db
    .select({
      sessionId: sessionsTable.id,
      lastSeenAt: sessionsTable.lastSeenAt,
      customerId: customers.id,
      phone: customers.phone,
      phoneVerifiedAt: customers.phoneVerifiedAt,
      firstName: customers.firstName,
      lastName: customers.lastName,
      email: customers.email,
      tier: customers.tier,
      pointsBalance: customers.pointsBalance,
      isBlocked: customers.isBlocked,
      lastLoginAt: customers.lastLoginAt,
    })
    .from(sessionsTable)
    .innerJoin(customers, eq(sessionsTable.customerId, customers.id))
    .where(
      and(
        eq(sessionsTable.tokenHash, tokenHash),
        isNull(sessionsTable.revokedAt),
        gt(sessionsTable.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  if (row.isBlocked) {
    await db
      .update(sessionsTable)
      .set({ revokedAt: sql`now()` })
      .where(eq(sessionsTable.id, row.sessionId));
    return null;
  }

  const now = Date.now();
  const lastSeen = row.lastSeenAt instanceof Date ? row.lastSeenAt : new Date(row.lastSeenAt);
  if (now - lastSeen.getTime() >= SESSION_TOUCH_MS) {
    await db
      .update(sessionsTable)
      .set({ lastSeenAt: sql`now()`, expiresAt: sql`now() + interval '180 days'` })
      .where(eq(sessionsTable.id, row.sessionId));
  }

  // DECISION: lastOtpAt is customers.last_login_at - for customers every login is an OTP verify
  // (verifyOtp sets last_login_at = now()), so it is the last successful verification.
  return {
    customerId: row.customerId,
    phone: row.phone,
    phoneVerifiedAt: row.phoneVerifiedAt === null ? null : toIso(row.phoneVerifiedAt),
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    tier: row.tier,
    pointsBalance: row.pointsBalance,
    isBlocked: row.isBlocked,
    sessionId: row.sessionId,
    lastOtpAt: row.lastLoginAt === null ? null : toIso(row.lastLoginAt),
  };
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  if (!SESSION_TOKEN_RE.test(token)) return;
  await db
    .update(sessionsTable)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessionsTable.tokenHash, hashToken(token, sessionPepper())), isNull(sessionsTable.revokedAt)));
}

export async function revokeAllSessions(db: Db, customerId: string): Promise<void> {
  await db
    .update(sessionsTable)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessionsTable.customerId, customerId), isNull(sessionsTable.revokedAt)));
}

export async function revokeSessionById(db: Db, customerId: string, sessionId: string): Promise<void> {
  const rows = await db
    .select({ id: sessionsTable.id })
    .from(sessionsTable)
    .where(and(eq(sessionsTable.id, sessionId), eq(sessionsTable.customerId, customerId)))
    .limit(1);
  if (rows[0] === undefined) throw appError("NOT_FOUND", { fa: "نشست پیدا نشد" });
  await db
    .update(sessionsTable)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessionsTable.id, sessionId), isNull(sessionsTable.revokedAt)));
}

export async function listSessions(
  db: Db,
  customerId: string,
  currentSessionId?: string,
): Promise<SessionInfo[]> {
  const rows = await db
    .select({
      id: sessionsTable.id,
      createdAt: sessionsTable.createdAt,
      lastSeenAt: sessionsTable.lastSeenAt,
      ip: sessionsTable.ip,
      ua: sessionsTable.ua,
    })
    .from(sessionsTable)
    .where(
      and(
        eq(sessionsTable.customerId, customerId),
        isNull(sessionsTable.revokedAt),
        gt(sessionsTable.expiresAt, sql`now()`),
      ),
    )
    .orderBy(sql`${sessionsTable.createdAt} desc`);
  return rows.map((r) => ({
    id: r.id,
    createdAt: toIso(r.createdAt),
    lastSeenAt: toIso(r.lastSeenAt),
    ipMasked: r.ip === null ? "0.0.0.0/24" : ipSlash24(String(r.ip)),
    uaClass: uaClass(r.ua ?? ""),
    current: currentSessionId !== undefined && r.id === currentSessionId,
  }));
}

export function uaClass(ua: string): UaClass {
  // DECISION: the authoritative UaClass (constants.UA_CLASSES) is mobile|desktop|inapp|pwa - there is
  // no "unknown" label (the sessions header predates the M0 dedup), and "pwa" is not derivable from a
  // UA string alone. An empty or unrecognized UA falls back to "desktop".
  if (/Instagram|FBAN|FBAV|Line\//i.test(ua)) return "inapp";
  if (/Mobile|Android|iPhone|iPad/i.test(ua)) return "mobile";
  return "desktop";
}
