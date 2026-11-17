import "server-only";
import { ERROR_FA } from "@namilux/core";
import { env } from "@/env";

export type LimitSpec = { tokens: number; perSec: number };
export const LIMITS: Record<string, LimitSpec> = {
  "otp.request.ip": { tokens: 20, perSec: 600 }, "otp.verify.ip": { tokens: 30, perSec: 600 }, me: { tokens: 60, perSec: 60 },
  "checkout.quote": { tokens: 60, perSec: 60 }, "checkout.place.customer": { tokens: 5, perSec: 600 }, "checkout.place.ip": { tokens: 10, perSec: 600 },
  callback: { tokens: 30, perSec: 600 }, track: { tokens: 10, perSec: 600 }, "bis.ip": { tokens: 20, perSec: 600 }, "reviews.customer": { tokens: 10, perSec: 86400 },
  "contact.ip": { tokens: 5, perSec: 600 }, beacon: { tokens: 120, perSec: 60 }, pages: { tokens: 300, perSec: 60 },
  // DECISION (M5/M7 routes): the four names below are the §2.1 rows that had no bucket yet - 
  // `POST /api/me/returns` (session 5/day), `POST /api/products/:id/questions` (customer 10/day),
  // the reviews GET listing (ip 60/min) and the PoW challenge issue for the two anonymous forms
  // (a challenge is cheap to mint, so it is not charged against the 5/10min submit budget).
  "returns.customer": { tokens: 5, perSec: 86400 }, "questions.customer": { tokens: 10, perSec: 86400 },
  "reviews.ip": { tokens: 60, perSec: 60 }, "pow.ip": { tokens: 20, perSec: 600 },
  // /api/e: the spec "ip 120/min" - a dropped beacon is silent (204), never an error.
  "beacon.ip": { tokens: 120, perSec: 60 },
};

/** Key spraying is the attack this bound exists for: 50 k buckets ≈ a few MB, and no more. */
const MAX_KEYS = 50_000;

type Bucket = { tokens: number; updatedAt: number };
// A Map preserves insertion order, so the oldest entry is always the head - that is the eviction
// order, and re-taking a key re-inserts it, which makes this a plain LRU without a second structure.
const buckets = new Map<string, Bucket>();

/**
 * DECISION (M8 e2e): on a developer machine and under Playwright every bucket is 50× wider so one
 * test IP is not throttled. The gate is APP_ENV, not the SMS driver: it used to read
 * `SMS_DRIVER === "mock"`, and a staging box on the real domain runs the SMS simulator - which
 * widened every public limit 50× there (contact 5→250 per 10 min, pow 20→1000, beacon 120→6000 per
 * minute). `dev` is the one environment that never serves the public: the env schema keeps
 * staging/prod for the published origins.
 */
const DEV_SCALE = env.APP_ENV === "dev" ? 50 : 1;

export function take(limit: keyof typeof LIMITS, key: string): { ok: boolean; retryAfterSec: number } {
  const base = LIMITS[limit];
  if (base === undefined) return { ok: true, retryAfterSec: 0 };
  // DEV_SCALE is 1 everywhere but a developer machine (see the DECISION above).
  const spec = { tokens: base.tokens * DEV_SCALE, perSec: base.perSec };

  const id = `${String(limit)}|${key}`;
  const now = Date.now();
  const existing = buckets.get(id);
  const refillPerMs = spec.tokens / (spec.perSec * 1000);

  let tokens: number;
  if (existing === undefined) {
    // First sight of a key starts full: a legitimate first request must never be delayed.
    tokens = spec.tokens;
  } else {
    buckets.delete(id); // re-insert below, so this key becomes the most recent
    tokens = Math.min(spec.tokens, existing.tokens + (now - existing.updatedAt) * refillPerMs);
  }

  if (tokens < 1) {
    buckets.set(id, { tokens, updatedAt: now });
    // Never 0 - a Retry-After of zero invites an immediate retry, which is the opposite of a brake.
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - tokens) / refillPerMs / 1000)) };
  }

  buckets.set(id, { tokens: tokens - 1, updatedAt: now });
  if (buckets.size > MAX_KEYS) {
    const oldest = buckets.keys().next();
    if (!oldest.done) buckets.delete(oldest.value);
  }
  return { ok: true, retryAfterSec: 0 };
}

export function rateLimited(retryAfterSec: number): Response {
  // The same envelope every other handler returns, with a Persian message that says
  // nothing about which limit was hit - that would tell an attacker which dial to turn.
  return new Response(JSON.stringify({ ok: false, error: { code: "RATE_LIMITED", message: ERROR_FA.RATE_LIMITED } }), {
    status: 429,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": String(Math.max(1, Math.ceil(retryAfterSec))),
    },
  });
}

/** Test seam: the buckets are module state, and a suite must be able to start from zero. */
export function resetLimits(): void {
  buckets.clear();
}
