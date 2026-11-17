import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { type Db, and, desc, eq, inArray, isNull, otpCodes, rateLimits, smsLog, sql } from "@namilux/db";
import type { OtpPurpose } from "../constants";
// DECISION (M0 step 3): OTP_MAX_ATTEMPTS is defined once in ../constants; this module consumes it.
import { OTP_CODE_TTL_SEC, OTP_MAX_ATTEMPTS } from "../constants";
import { appError } from "../errors";
import { ulid } from "../ids";
import { enDigits, maskPhone, normalizePhone } from "../persian";
import { security } from "../security";
import { getSetting } from "../settings/service";
import { jobs } from "../jobs";
import { upsertByPhone } from "../customers/repo";
import { type QuotaRow, otpQuota, quotaKeys, verifyKey } from "./quota";
import { breaker } from "./breaker";
import type { SalesChannel } from "../channel";

export const OTP_TTL_SEC = OTP_CODE_TTL_SEC;
export const OTP_CODE_RE = /^\d{6}$/;

export type OtpSendResult = { ok: true; providerRef?: string; cost?: number } | { ok: false; error: string };

export type OtpAdapters = {
  send: (i: { phone: string; code: string; purpose: OtpPurpose }) => Promise<OtpSendResult>;
  verifyPow: (token: string, scope: string) => Promise<boolean>;
};

// DECISION: packages/core does not import @namilux/integrations (the spec purity). The SMS sender and PoW
// verifier are injected once at app start; a missing adapter throws INTERNAL loudly on first use.
let adapters: OtpAdapters | null = null;

export function configureOtp(next: OtpAdapters): void {
  adapters = next;
}

function requireAdapters(): OtpAdapters {
  if (adapters === null) throw appError("INTERNAL", { details: "OTP adapters are not configured" });
  return adapters;
}

function otpPepper(): string {
  const p = process.env.OTP_PEPPER;
  if (typeof p !== "string" || p === "") throw appError("INTERNAL", { details: "OTP_PEPPER is not configured" });
  return p;
}

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(code: string, pepper: string): string {
  return createHash("sha256").update(code + pepper).digest("hex");
}

function phoneHash(phone: string, pepper: string): string {
  return createHash("sha256").update(phone + pepper).digest("hex");
}

export async function requestOtp(
  db: Db,
  i: { phone: string; purpose: OtpPurpose; ip: string; uaHash: string; powToken?: string },
): Promise<{ resendAfterSec: number; captchaRequired: boolean; expiresAt: string | null }> {
  const phone = normalizePhone(i.phone);
  if (phone === null) throw appError("VALIDATION", { fa: "شمارهٔ موبایل معتبر نیست" });
  const ad = requireAdapters();
  const pepper = otpPepper();

  const limits = await getSetting(db, "otp.limits");
  const keys = quotaKeys({ phone, ip: i.ip, uaHash: i.uaHash });

  const b = await breaker.shouldPause(db, limits);
  if (b === "pause") {
    throw appError("RATE_LIMITED", {
      httpStatus: 503,
      fa: "ارسال پیامک موقتاً متوقف شده است؛ چند دقیقه بعد دوباره تلاش کنید",
    });
  }

  const q = await otpQuota.check(db, keys, limits);
  if (q === "blocked") {
    const now = new Date();
    const rows = (await db
      .select({ key: rateLimits.key, windowStart: rateLimits.windowStart, count: rateLimits.count })
      .from(rateLimits)
      .where(inArray(rateLimits.key, keys))) as QuotaRow[];
    throw appError("RATE_LIMITED", {
      fa: "تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید",
      details: { retryAfterSec: otpQuota.retryAfterSec(rows, keys, limits, now) },
    });
  }

  const needPow = q === "captcha" || b === "captcha";
  if (needPow) {
    const ok = i.powToken !== undefined && (await ad.verifyPow(i.powToken, `otp:${phone}`));
    if (!ok) return { resendAfterSec: 0, captchaRequired: true, expiresAt: null };
  }

  // cooldown: a recent *live* code for this phone (any purpose) → return the remaining wait, send
  // nothing. A code that has already been consumed (the shopper logged in) does not throttle a new
  // request; without the consumed filter a second login inside cooldownSec is wrongly suppressed.
  // DECISION: spec step 6 says "latest otp_codes row"; it is scoped to consumedAt IS NULL so a
  //           just-consumed code does not block a fresh request (otp.test happy path relies on this).
  const recent = await db
    .select({ createdAt: otpCodes.createdAt, expiresAt: otpCodes.expiresAt })
    .from(otpCodes)
    .where(and(eq(otpCodes.phone, phone), eq(otpCodes.purpose, i.purpose), isNull(otpCodes.consumedAt), sql`${otpCodes.expiresAt} > now()`))
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);
  if (recent[0] !== undefined) {
    const age = (Date.now() - new Date(recent[0].createdAt).getTime()) / 1000;
    if (age < limits.cooldownSec) {
      return { resendAfterSec: Math.ceil(limits.cooldownSec - age), captchaRequired: false, expiresAt: new Date(recent[0].expiresAt).toISOString() };
    }
  }

  // invalidate any live code for this phone+purpose, then mint a fresh one
  await db
    .update(otpCodes)
    .set({ expiresAt: sql`now()` })
    .where(
      and(
        eq(otpCodes.phone, phone),
        eq(otpCodes.purpose, i.purpose),
        isNull(otpCodes.consumedAt),
        sql`${otpCodes.expiresAt} > now()`,
      ),
    );

  const code = generateOtpCode();
  const [issued] = await db.insert(otpCodes).values({
    id: ulid(),
    phone,
    purpose: i.purpose,
    codeHash: hashOtp(code, pepper),
    attempts: 0,
    maxAttempts: OTP_MAX_ATTEMPTS,
    expiresAt: sql`now() + (${OTP_TTL_SEC} * interval '1 second')`,
    // DECISION (M8 browser check): inet column - an unknown client address is NULL, never "".
    ip: i.ip === "" ? null : i.ip,
    uaHash: i.uaHash,
  }).returning({ expiresAt: otpCodes.expiresAt });
  if (issued === undefined) throw appError("INTERNAL");

  // consume quota BEFORE the send: a failing provider still costs quota
  await otpQuota.consume(db, keys);

  const provider = process.env.SMS_DRIVER ?? "mock";
  const result = await ad.send({ phone, code, purpose: i.purpose });
  await db.insert(smsLog).values({
    id: ulid(),
    toMasked: maskPhone(phone),
    toHash: phoneHash(phone, pepper),
    template: "otp",
    provider,
    status: result.ok ? "sent" : "failed",
    providerRef: result.ok ? result.providerRef ?? null : null,
    cost: result.ok ? result.cost ?? null : null,
    error: result.ok ? null : result.error,
  });
  if (!result.ok) {
    throw appError("INTERNAL", { httpStatus: 502, fa: "ارسال پیامک ممکن نشد؛ کمی بعد دوباره تلاش کنید" });
  }

  return { resendAfterSec: limits.cooldownSec, captchaRequired: false, expiresAt: issued.expiresAt.toISOString() };
}

export async function verifyOtp(
  db: Db,
  i: { phone: string; code: string; purpose: OtpPurpose; ip: string; channel?: SalesChannel },
): Promise<{ customerId: string; isNew: boolean }> {
  const phone = normalizePhone(i.phone);
  if (phone === null) throw appError("VALIDATION", { fa: "شمارهٔ موبایل معتبر نیست" });
  const code = enDigits(i.code).trim();
  if (!OTP_CODE_RE.test(code)) throw appError("OTP_INVALID", { fa: "کد وارد شده درست نیست" });
  const pepper = otpPepper();

  const limits = await getSetting(db, "otp.limits");
  const vKey = verifyKey(i.ip);
  if ((await otpQuota.check(db, [vKey], limits)) === "blocked") {
    throw appError("RATE_LIMITED", { fa: "تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد دوباره تلاش کنید" });
  }
  await otpQuota.consume(db, [vKey]);

  // The attempt increment, the "otp.locked" security event and the consume-on-blocked-customer must
  // survive a failed verification, so the transaction NEVER throws for a business outcome: it returns
  // a discriminated result (which commits the writes) and the AppError is raised afterwards. Throwing
  // inside db.transaction would roll the increment back and defeat the brute-force lockout.
  const outcome = await db.transaction<VerifyOutcome>(async (tx) => {
    const rows = await tx
      .select()
      .from(otpCodes)
      .where(and(eq(otpCodes.phone, phone), eq(otpCodes.purpose, i.purpose), isNull(otpCodes.consumedAt)))
      .orderBy(desc(otpCodes.createdAt))
      .limit(1)
      .for("update");
    const row = rows[0];
    if (row === undefined) return { kind: "expired-none" };
    const now = Date.now();
    if (new Date(row.expiresAt).getTime() <= now) return { kind: "expired" };
    if (row.attempts >= row.maxAttempts) return { kind: "locked" };

    // increment before comparing so concurrent verifies cannot exceed max_attempts
    await tx.update(otpCodes).set({ attempts: sql`${otpCodes.attempts} + 1` }).where(eq(otpCodes.id, row.id));

    const expected = Buffer.from(hashOtp(code, pepper));
    const stored = Buffer.from(row.codeHash);
    const matches = expected.length === stored.length && timingSafeEqual(expected, stored);
    if (!matches) {
      if (row.attempts + 1 >= row.maxAttempts) {
        await security.event(tx, "otp.locked", { purpose: i.purpose }, i.ip, maskPhone(phone));
        return { kind: "locked" };
      }
      return { kind: "invalid", attemptsLeft: row.maxAttempts - (row.attempts + 1) };
    }

    const consumed = await tx
      .update(otpCodes)
      .set({ consumedAt: sql`now()` })
      .where(and(eq(otpCodes.id, row.id), isNull(otpCodes.consumedAt)))
      .returning({ id: otpCodes.id });
    if (consumed[0] === undefined) return { kind: "expired" };

    const { customer, isNew } = await upsertByPhone(tx, phone);
    // A blocked customer's code is consumed anyway; the commit above persists that.
    if (customer.isBlocked) return { kind: "blocked" };
    // First verified login = account created. Enqueued in this transaction so the greeting cannot
    // outlive a rolled-back signup, and keyed on the customer so a re-login never sends it twice.
    if (isNew) {
      // The welcome prints the address of the site the account was opened on, so an instalment-site
      // signup says so; the main site's payload is unchanged.
      await jobs.enqueue(tx, "sms.send", { template: "customer.welcome", phone, ...(i.channel === "instalments" ? { channel: i.channel } : {}) }, { uniqueKey: `welcome:${customer.id}` });
    }
    return { kind: "ok", customerId: customer.id, isNew };
  });

  switch (outcome.kind) {
    case "expired-none":
      throw appError("OTP_EXPIRED", { fa: "کدی برای این شماره ثبت نشده است؛ کد تازه‌ای درخواست کنید" });
    case "expired":
      throw appError("OTP_EXPIRED", { fa: "کد منقضی شده است؛ کد تازه‌ای درخواست کنید" });
    case "locked":
      throw appError("OTP_LOCKED", { fa: "تعداد تلاش‌ها بیش از حد مجاز بود؛ کد تازه‌ای درخواست کنید" });
    case "invalid":
      throw appError("OTP_INVALID", {
        fa: "کد وارد شده درست نیست",
        details: { attemptsLeft: outcome.attemptsLeft },
      });
    case "blocked":
      throw appError("FORBIDDEN", { fa: "حساب شما مسدود شده است؛ با پشتیبانی تماس بگیرید" });
    case "ok":
      return { customerId: outcome.customerId, isNew: outcome.isNew };
  }
}

type VerifyOutcome =
  | { kind: "ok"; customerId: string; isNew: boolean }
  | { kind: "expired-none" }
  | { kind: "expired" }
  | { kind: "locked" }
  | { kind: "invalid"; attemptsLeft: number }
  | { kind: "blocked" };
