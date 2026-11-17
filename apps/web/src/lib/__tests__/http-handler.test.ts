import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type * as HttpHandler from "../http-handler";

/** The envelope every failing branch answers with, so a case can read it without an `any`. */
type Envelope = { ok: boolean; error: { code: string; message: string; ref?: string } };

const SITE_ORIGIN = "https://namilux.ir";
const SIGNING_KEY = "test-internal-key";

/** The handler reads `env` and the limiter at module scope, so both are mocked before it loads. */
async function load(): Promise<typeof HttpHandler> {
  vi.resetModules();
  vi.doMock("@/env", () => ({
    env: { SITE_ORIGIN, INTERNAL_SIGNING_KEY: SIGNING_KEY, TRUST_PROXY: false },
  }));
  return await import("../http-handler");
}

/** Next hands route handlers a promise of params; nothing here needs a value in it. */
const ctx = { params: Promise.resolve({}) };

const post = (body: string, headers: Record<string, string> = {}): Request =>
  new Request(`${SITE_ORIGIN}/api/thing`, {
    method: "POST",
    body,
    headers: { "content-type": "application/json", origin: SITE_ORIGIN, "sec-fetch-site": "same-origin", ...headers },
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-26T12:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock("@/env");
  vi.restoreAllMocks();
});

describe("http handler", () => {
  it("ok/fail envelope shapes", async () => {
    const { handler, ok, fail } = await load();
    const { AppError, ERROR_FA } = await import("@namilux/core");

    const success = ok({ id: 7 });
    expect(success.status).toBe(200);
    // the spec: every response is no-store and JSON; nothing under /api is ever cached.
    expect(success.headers.get("cache-control")).toBe("no-store");
    expect(success.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await success.json()).toEqual({ ok: true, data: { id: 7 } });

    const failure = fail(new AppError("NOT_FOUND", 404, ERROR_FA.NOT_FOUND));
    expect(failure.status).toBe(404);
    const body = (await failure.json()) as Envelope & { code?: string };
    expect(body.ok).toBe(false);
    // The code lives inside `error`, never at the top level - one envelope shape site-wide.
    expect(body.code).toBeUndefined();
    // The shopper gets the Persian sentence, never the English code as copy.
    expect(body.error).toEqual({ code: "NOT_FOUND", message: ERROR_FA.NOT_FOUND });

    // And through the wrapper: a GET with no schema still answers the envelope.
    const route = handler({ auth: "none", run: async () => ({ hello: "دنیا" }) });
    const res = await route(new Request(`${SITE_ORIGIN}/api/thing`), ctx);
    expect(await res.json()).toEqual({ ok: true, data: { hello: "دنیا" } });
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("unknown error masked with ref id", async () => {
    const { handler } = await load();
    const route = handler({
      auth: "none",
      run: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:5432 — nl_web@namilux");
      },
    });

    const res = await route(new Request(`${SITE_ORIGIN}/api/thing`), ctx);
    expect(res.status).toBe(500);
    const body = (await res.json()) as Envelope;
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.ref).toEqual(expect.any(String));
    // Nothing about what actually broke crosses the boundary - not the host, not the role, not the driver.
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|5432|nl_web/);
  });

  it("body over cap → 413 VALIDATION", async () => {
    const { handler } = await load();
    const run = vi.fn().mockResolvedValue({});
    const route = handler({ auth: "none", bodyCap: 64, schema: z.object({ note: z.string() }).strict(), run });

    const res = await route(post(JSON.stringify({ note: "ا".repeat(200) })), ctx);
    expect(res.status).toBe(413);
    expect(((await res.json()) as Envelope).error.code).toBe("VALIDATION");
    // The cap answers BEFORE the parse, so an oversized body is never turned into objects.
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a body with unknown keys and unparseable JSON", async () => {
    const { handler } = await load();
    const route = handler({ auth: "none", schema: z.object({ note: z.string() }).strict(), run: async () => ({}) });

    // zod .strict(): an extra key is a rejection, not a silently dropped field.
    const extra = await route(post(JSON.stringify({ note: "سلام", isAdmin: true })), ctx);
    expect(extra.status).toBe(400);
    expect(((await extra.json()) as Envelope).error.code).toBe("VALIDATION");

    const broken = await route(post("{not json"), ctx);
    expect(broken.status).toBe(400);
    expect(((await broken.json()) as Envelope).error.code).toBe("VALIDATION");
  });

  it("cross-site POST rejected", async () => {
    const { handler } = await load();
    const run = vi.fn().mockResolvedValue({});
    const route = handler({ auth: "none", run });

    // the spec: Sec-Fetch-Site is the modern gate…
    const crossSite = await route(post("{}", { "sec-fetch-site": "cross-site" }), ctx);
    expect(crossSite.status).toBe(403);
    expect(((await crossSite.json()) as Envelope).error.code).toBe("FORBIDDEN");

    // …and a foreign Origin is refused even when the fetch metadata is missing or lies.
    const foreignOrigin = await route(post("{}", { origin: "https://evil.example" }), ctx);
    expect(foreignOrigin.status).toBe(403);

    expect(run).not.toHaveBeenCalled();

    // same-origin passes, and so does the "none" case (a top-level form post or an address bar).
    const same = await route(post("{}"), ctx);
    expect(same.status).toBe(200);
    const typedIn = await route(post("{}", { "sec-fetch-site": "none" }), ctx);
    expect(typedIn.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("a GET is never subjected to the CSRF gate", async () => {
    // the spec edge cases: the gateway's callback is a cross-site navigation by design.
    const { handler } = await load();
    const route = handler({ auth: "none", run: async () => ({ seen: true }) });
    const res = await route(
      new Request(`${SITE_ORIGIN}/api/payment/callback/zarinpal`, { headers: { "sec-fetch-site": "cross-site" } }),
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it("internal hmac timestamp window", async () => {
    const { verifyInternalHmac } = await load();
    const body = JSON.stringify({ job: "revalidate" });
    const sign = (ts: string, payload = body, key = SIGNING_KEY): string =>
      createHmac("sha256", key).update(`${ts}.${payload}`).digest("hex");
    const req = (ts: string, sig: string): Request =>
      new Request(`${SITE_ORIGIN}/api/internal/x`, { method: "POST", headers: { "x-nl-ts": ts, "x-nl-sig": sig } });

    const now = String(Date.now());
    expect(verifyInternalHmac(req(now, sign(now)), body, SIGNING_KEY)).toBe(true);

    // Inside the ±5 min window, either side.
    const recent = String(Date.now() - 4 * 60 * 1000);
    expect(verifyInternalHmac(req(recent, sign(recent)), body, SIGNING_KEY)).toBe(true);
    const ahead = String(Date.now() + 4 * 60 * 1000);
    expect(verifyInternalHmac(req(ahead, sign(ahead)), body, SIGNING_KEY)).toBe(true);

    // Outside it, a perfectly valid signature is refused - that is what stops a replay.
    const old = String(Date.now() - 6 * 60 * 1000);
    expect(verifyInternalHmac(req(old, sign(old)), body, SIGNING_KEY)).toBe(false);

    // The timestamp is inside the signed string, so it cannot be moved without resigning.
    expect(verifyInternalHmac(req(now, sign(old)), body, SIGNING_KEY)).toBe(false);
    // Nor can the body be swapped under a captured signature.
    expect(verifyInternalHmac(req(now, sign(now)), JSON.stringify({ job: "drop" }), SIGNING_KEY)).toBe(false);
    // A wrong key, a malformed hex signature and a missing header all fail closed.
    expect(verifyInternalHmac(req(now, sign(now, body, "other")), body, SIGNING_KEY)).toBe(false);
    expect(verifyInternalHmac(req(now, "zz"), body, SIGNING_KEY)).toBe(false);
    expect(verifyInternalHmac(new Request(`${SITE_ORIGIN}/api/internal/x`, { method: "POST" }), body, SIGNING_KEY)).toBe(false);
    // An empty configured key never validates, so a misconfigured deploy cannot be signed into.
    expect(verifyInternalHmac(req(now, sign(now, body, "")), body, "")).toBe(false);
  });

  it("a session route fails closed until lib/session.ts lands", async () => {
    // The PARTIAL in http-handler.ts: `auth: "session"` must never run its body for an anonymous
    // caller, so until the lookup exists every session route answers UNAUTHORIZED.
    const { handler } = await load();
    const run = vi.fn().mockResolvedValue({});
    const route = handler({ auth: "session", run });
    const res = await route(new Request(`${SITE_ORIGIN}/api/me`), ctx);
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
});
