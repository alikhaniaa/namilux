import { type Db, inArray, rateLimits, sql } from "@namilux/db";
import { z } from "zod";
// DECISION (M0 step 3): OtpLimits is defined once in ../types (alias of the settings key "otp.limits").
import type { OtpLimits } from "../types";
import { appError } from "../errors";

export const otpLimitsSchema: z.ZodType<OtpLimits> = z
  .object({
    phonePer10m: z.number().int().min(0),
    phonePerDay: z.number().int().min(0),
    ipPer10m: z.number().int().min(0),
    uaPerDay: z.number().int().min(0),
    cooldownSec: z.number().int().min(0),
    captchaAfter: z.number().int().min(0),
    global10m: z.number().int().min(0),
    pauseMultiplier: z.number().int().min(1),
    verifyIpPer10m: z.number().int().min(0),
  })
  .strict();

export const DEFAULT_OTP_LIMITS: OtpLimits = {
  phonePer10m: 3,
  phonePerDay: 6,
  ipPer10m: 20,
  uaPerDay: 10,
  cooldownSec: 60,
  captchaAfter: 3,
  global10m: 200,
  pauseMultiplier: 3,
  verifyIpPer10m: 30,
};

export type QuotaWindow = "10m" | "1d";

export const QUOTA_WINDOW_MS: Record<QuotaWindow, number> = { "10m": 600_000, "1d": 86_400_000 };

export const GLOBAL_KEY = "otp:global:10m";

export type QuotaRow = { key: string; windowStart: Date; count: number };

export function ipSlash24(ip: string): string {
  const s = (ip ?? "").trim();
  // IPv4 (also IPv4-mapped like ::ffff:1.2.3.4 handled by the trailing-dotted-quad check)
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4 && !s.includes(":")) {
    const octets = [v4[1], v4[2], v4[3]].map((o) => Number(o));
    if (octets.every((o) => o >= 0 && o <= 255)) {
      return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
    }
    return "0.0.0.0/24";
  }
  if (s.includes(":")) {
    // IPv6 → first 4 hextets, lowercase, leading zeros stripped, + "::/64"
    const head = s.split("::")[0] ?? "";
    const groups = head.split(":").filter((g) => g !== "");
    if (groups.length >= 4 && groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) {
      const four = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "").toLowerCase());
      return `${four.join(":")}::/64`;
    }
    return "0.0.0.0/24";
  }
  return "0.0.0.0/24";
}

export function quotaKeys(i: { phone: string; ip: string; uaHash: string }): string[] {
  const ip24 = ipSlash24(i.ip);
  return [
    `otp:phone:${i.phone}:10m`,
    `otp:phone:${i.phone}:1d`,
    `otp:ip:${ip24}:10m`,
    `otp:ua:${i.uaHash}:1d`,
    GLOBAL_KEY,
  ];
}

export function verifyKey(ip: string): string {
  return `otpv:ip:${ipSlash24(ip)}:10m`;
}

export function windowOf(key: string): QuotaWindow {
  if (key.endsWith(":10m")) return "10m";
  if (key.endsWith(":1d")) return "1d";
  throw appError("INTERNAL", { details: `quota key has no window suffix: ${key}` });
}

export function limitForKey(key: string, limits: OtpLimits): number | null {
  if (key === GLOBAL_KEY) return limits.global10m * limits.pauseMultiplier;
  if (/^otp:phone:.*:10m$/.test(key)) return limits.phonePer10m;
  if (/^otp:phone:.*:1d$/.test(key)) return limits.phonePerDay;
  if (/^otp:ip:.*:10m$/.test(key)) return limits.ipPer10m;
  if (/^otp:ua:.*:1d$/.test(key)) return limits.uaPerDay;
  if (/^otpv:ip:.*:10m$/.test(key)) return limits.verifyIpPer10m;
  return null;
}

export function effectiveCount(row: QuotaRow | undefined, now: Date): number {
  if (row === undefined) return 0;
  const windowMs = QUOTA_WINDOW_MS[windowOf(row.key)];
  if (row.windowStart.getTime() + windowMs <= now.getTime()) return 0;
  return row.count;
}

function rowsByKey(rows: QuotaRow[]): Map<string, QuotaRow> {
  const m = new Map<string, QuotaRow>();
  for (const r of rows) m.set(r.key, r);
  return m;
}

export function evaluate(
  rows: QuotaRow[],
  keys: string[],
  limits: OtpLimits,
  now: Date,
): "ok" | "captcha" | "blocked" {
  const byKey = rowsByKey(rows);
  for (const key of keys) {
    const limit = limitForKey(key, limits);
    if (limit === null) continue;
    if (effectiveCount(byKey.get(key), now) >= limit) return "blocked";
  }
  for (const key of keys) {
    const isPhone10m = /^otp:phone:.*:10m$/.test(key);
    const isIp10m = /^otp:ip:.*:10m$/.test(key);
    if ((isPhone10m || isIp10m) && effectiveCount(byKey.get(key), now) >= limits.captchaAfter) {
      return "captcha";
    }
  }
  return "ok";
}

/** Postgres interval literal for a quota window. */
function windowInterval(w: QuotaWindow) {
  return w === "1d" ? sql`interval '1 day'` : sql`interval '10 minutes'`;
}

export const otpQuota = {
  async check(db: Db, keys: string[], limits: OtpLimits): Promise<"ok" | "captcha" | "blocked"> {
    if (keys.length === 0) return "ok";
    const rows = (await db
      .select({ key: rateLimits.key, windowStart: rateLimits.windowStart, count: rateLimits.count })
      .from(rateLimits)
      .where(inArray(rateLimits.key, keys))) as QuotaRow[];
    return evaluate(rows, keys, limits, new Date());
  },
  async consume(db: Db, keys: string[]): Promise<void> {
    for (const key of keys) {
      const iv = windowInterval(windowOf(key));
      await db
        .insert(rateLimits)
        .values({ key, windowStart: sql`now()`, count: 1 })
        .onConflictDoUpdate({
          target: rateLimits.key,
          set: {
            count: sql`case when ${rateLimits.windowStart} + ${iv} <= now() then 1 else ${rateLimits.count} + 1 end`,
            windowStart: sql`case when ${rateLimits.windowStart} + ${iv} <= now() then now() else ${rateLimits.windowStart} end`,
          },
        });
    }
  },
  retryAfterSec(rows: QuotaRow[], keys: string[], limits: OtpLimits, now: Date): number {
    const byKey = rowsByKey(rows);
    let best = Number.POSITIVE_INFINITY;
    for (const key of keys) {
      const limit = limitForKey(key, limits);
      if (limit === null) continue;
      const row = byKey.get(key);
      if (effectiveCount(row, now) < limit || row === undefined) continue;
      const windowMs = QUOTA_WINDOW_MS[windowOf(key)];
      const end = row.windowStart.getTime() + windowMs;
      const sec = Math.ceil((end - now.getTime()) / 1000);
      if (sec < best) best = sec;
    }
    if (!Number.isFinite(best)) return 1;
    return Math.max(1, best);
  },
  async prune(db: Db, now: Date): Promise<number> {
    void now;
    const rows = await db
      .delete(rateLimits)
      .where(
        sql`${rateLimits.windowStart} + case when ${rateLimits.key} like '%:1d' then interval '1 day' else interval '10 minutes' end < now() - interval '2 days'`,
      )
      .returning({ key: rateLimits.key });
    return rows.length;
  },
};
