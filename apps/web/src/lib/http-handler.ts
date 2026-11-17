import "server-only";
import { clientIpFromHeaders } from "@namilux/config/client-ip";
import { AppError, ERROR_FA, isAppError, ulid } from "@namilux/core";
import type { SessionUser } from "@namilux/core";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { z } from "zod";
import { rateLimited, take } from "./ratelimit";
import type { LIMITS } from "./ratelimit";
import { currentUser, isRecentlyVerified } from "./session";
import { env } from "@/env";

const DEFAULT_BODY_CAP = 8 * 1024;
const HMAC_WINDOW_MS = 5 * 60 * 1000;

export type HandlerCtx<I> = { input: I; user: SessionUser | null; ip: string; ua: string; req: Request; params: Record<string, string>; nonce?: string };
export type HandlerSpec<S extends z.ZodTypeAny | undefined, R> = {
  schema?: S; bodyCap?: number; auth: "none" | "optional" | "session" | "session-verified" | "internal-hmac";
  limit?: { name: keyof typeof LIMITS; key: (ctx: { ip: string; user: SessionUser | null; params: Record<string, string> }) => string }[];
  run: (ctx: HandlerCtx<S extends z.ZodTypeAny ? z.infer<S> : undefined>) => Promise<R>;
};

const NO_STORE = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } as const;

export function ok<T>(data: T, init?: { status?: number; headers?: HeadersInit }): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: init?.status ?? 200,
    headers: { ...NO_STORE, ...(init?.headers ?? {}) },
  });
}

export function fail(e: AppError, ref?: string): Response {
  // `e.fa` is the Persian sentence the shopper sees; `details` never crosses this boundary, because
  // it can carry the internals that produced the error.
  return new Response(
    JSON.stringify({ ok: false, error: { code: e.code, message: e.fa, ...(ref === undefined ? {} : { ref }) } }),
    { status: e.httpStatus, headers: NO_STORE },
  );
}

/**
 * The answer a route gives while its body was not yet built when this was written.
 *
 * DECISION: not in this file's contract, and not a `throw`. `next build` prerenders every GET route
 * handler, so a throwing stub fails the build for the whole app; and the usual escape,
 * `export const dynamic = "force-dynamic"`, is rejected under `cacheComponents`. A 501 in the
 * standard envelope keeps the spec true for every response, including the ones not written yet.
 */
/** Server-side record of an unexpected (non-AppError) failure, keyed by the request id the client received. */
export function logInternal(ref: string, e: unknown): void {
  const err = e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : { value: String(e) };
  // eslint-disable-next-line no-console -- the one place an unexpected server error is recorded (pino-shaped line on stderr)
  console.error(JSON.stringify({ level: 50, app: "web", ref, msg: "internal error", err }));
}

export function notImplemented(): Response {
  return new Response(JSON.stringify({ ok: false, error: { code: "INTERNAL", message: ERROR_FA.INTERNAL } }), {
    status: 501,
    headers: NO_STORE,
  });
}

/**
 * the spec: `x-nl-sig` is HMAC-SHA256(key, `${ts}.${body}`) and `x-nl-ts` must be within five
 * minutes - the timestamp is inside the signed string, so a captured call cannot be replayed later.
 */
export function verifyInternalHmac(req: Request, body: string, key: string): boolean {
  const sig = req.headers.get("x-nl-sig");
  const ts = req.headers.get("x-nl-ts");
  if (sig === null || ts === null || key === "") return false;
  const at = Number.parseInt(ts, 10);
  if (!Number.isFinite(at) || Math.abs(Date.now() - at) > HMAC_WINDOW_MS) return false;

  const expected = createHmac("sha256", key).update(`${ts}.${body}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sig, "hex");
  } catch {
    return false;
  }
  // Compare in constant time, and only after the lengths match - timingSafeEqual throws otherwise.
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Reads a request body up to `cap` bytes. Returns null - without buffering the rest - when the
 * declared Content-Length or the bytes actually received exceed the cap.
 */
export async function readBodyCapped(req: Request, cap: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) return null;
  if (req.body === null) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function clientIp(req: Request): string {
  // TRUST_PROXY is what makes x-forwarded-for meaningful; without it the header is attacker input.
  // The helper reads the LAST hop (the one our own edge wrote) - the first hop is client-controlled
  // whenever a proxy appends, which is how rate limits and allow-lists get bypassed.
  return clientIpFromHeaders(req.headers, env.TRUST_PROXY);
}

/** the spec: a state-changing request must be same-origin. Sec-Fetch-Site is the modern gate. */
function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return false;
  const origin = req.headers.get("origin");
  return origin === null || origin === env.SITE_ORIGIN;
}

export function handler<S extends z.ZodTypeAny | undefined, R>(
  spec: HandlerSpec<S, R>,
): (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> {
  return async (req, ctx) => {
    const requestId = req.headers.get("x-request-id") ?? ulid();
    try {
      const params = await ctx.params;
      const mutating = req.method !== "GET" && req.method !== "HEAD";

      if (mutating && spec.auth !== "internal-hmac" && !sameOrigin(req)) {
        return fail(new AppError("FORBIDDEN", 403, ERROR_FA.FORBIDDEN));
      }

      // Read once: the raw text is needed both for the body cap and for the HMAC. The cap is
      // enforced while streaming, so an oversized body is dropped after `cap` bytes instead of
      // being buffered whole and measured afterwards.
      let raw = "";
      if (mutating) {
        const body = await readBodyCapped(req, spec.bodyCap ?? DEFAULT_BODY_CAP);
        if (body === null) return fail(new AppError("VALIDATION", 413, ERROR_FA.VALIDATION));
        raw = body;
      }

      if (spec.auth === "internal-hmac" && !verifyInternalHmac(req, raw, env.INTERNAL_SIGNING_KEY)) {
        return fail(new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED));
      }

      // Resolve the session for the protected branches (M2). "optional" resolves it when the cookie is
      // present but tolerates its absence (the spec: a guest may quote). "session"/"session-verified"
      // require it; "session-verified" additionally requires a fresh OTP - a stale session
      // cannot perform re-verification-gated actions.
      let user: SessionUser | null = null;
      if (spec.auth === "optional" || spec.auth === "session" || spec.auth === "session-verified") {
        user = await currentUser();
        if (user === null && spec.auth !== "optional") {
          return fail(new AppError("UNAUTHORIZED", 401, ERROR_FA.UNAUTHORIZED));
        }
        if (spec.auth === "session-verified" && user !== null && !isRecentlyVerified(user)) {
          return fail(new AppError("UNAUTHORIZED", 401, "برای این کار باید دوباره با پیامک تأیید کنید"));
        }
      }

      const ip = clientIp(req);
      for (const rule of spec.limit ?? []) {
        const verdict = take(rule.name, rule.key({ ip, user, params }));
        if (!verdict.ok) return rateLimited(verdict.retryAfterSec);
      }

      let input: unknown;
      if (spec.schema !== undefined) {
        let parsedJson: unknown = undefined;
        if (raw !== "") {
          try {
            parsedJson = JSON.parse(raw);
          } catch {
            return fail(new AppError("VALIDATION", 400, ERROR_FA.VALIDATION));
          }
        }
        const parsed = spec.schema.safeParse(parsedJson);
        if (!parsed.success) return fail(new AppError("VALIDATION", 400, ERROR_FA.VALIDATION));
        input = parsed.data;
      }

      const nonce = req.headers.get("x-nonce");
      const data = await spec.run({
        input: input as S extends z.ZodTypeAny ? z.infer<S> : undefined,
        user,
        ip,
        ua: req.headers.get("user-agent") ?? "",
        req,
        params,
        ...(nonce === null ? {} : { nonce }),
      });
      return ok(data, { headers: { "X-Request-Id": requestId } });
    } catch (e) {
      if (isAppError(e)) return fail(e, requestId);
      // An unknown error is masked: the shopper gets one Persian sentence and a correlation id, and
      // nothing about what actually broke. The server log keeps the cause under the same id.
      logInternal(requestId, e);
      return fail(new AppError("INTERNAL", 500, ERROR_FA.INTERNAL), requestId);
    }
  };
}
