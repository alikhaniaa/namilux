import { afterEach, describe, expect, it, vi } from "vitest";
import { ERROR_FA } from "@namilux/core";
import type * as RateLimit from "../ratelimit";

/**
 * The scale factor is read from `env` at module scope, so every case loads the module fresh behind
 * its own `@/env`. `SMS_DRIVER: "mock"` is set in each of them on purpose: the driver used to be
 * what widened the buckets, and the whole point of these cases is that it no longer is.
 */
async function load(appEnv: string): Promise<typeof RateLimit> {
  vi.resetModules();
  vi.doMock("@/env", () => ({ env: { APP_ENV: appEnv, SMS_DRIVER: "mock" } }));
  return await import("../ratelimit");
}

/** Takes until the bucket refuses, and answers how many takes were granted. */
function drain(take: typeof RateLimit.take, limit: string, key: string, ceiling: number): number {
  for (let i = 0; i < ceiling; i += 1) {
    if (!take(limit, key).ok) return i;
  }
  return ceiling;
}

afterEach(() => {
  vi.doUnmock("@/env");
  vi.resetModules();
});

describe("rate limits - the scale factor", () => {
  it("staging on the mock SMS driver gets the documented budget, not 50×", async () => {
    const { LIMITS, take, resetLimits } = await load("staging");
    resetLimits();
    // contact.ip is 5 per 10 min; a public staging box must enforce exactly that.
    expect(LIMITS["contact.ip"]?.tokens).toBe(5);
    expect(drain(take, "contact.ip", "1.2.3.4", 60)).toBe(5);
    expect(drain(take, "beacon.ip", "1.2.3.4", 400)).toBe(120);
  });

  it("prod gets the documented budget", async () => {
    const { take, resetLimits } = await load("prod");
    resetLimits();
    expect(drain(take, "contact.ip", "1.2.3.4", 60)).toBe(5);
  });

  it("dev is 50× wider so one Playwright IP is not throttled", async () => {
    const { take, resetLimits } = await load("dev");
    resetLimits();
    expect(drain(take, "contact.ip", "1.2.3.4", 400)).toBe(250);
  });

  it("a refusal carries a positive Retry-After and the Persian message", async () => {
    const { take, rateLimited, resetLimits } = await load("prod");
    resetLimits();
    drain(take, "contact.ip", "9.9.9.9", 60);
    const refused = take("contact.ip", "9.9.9.9");
    expect(refused.ok).toBe(false);
    expect(refused.retryAfterSec).toBeGreaterThan(0);

    const res = rateLimited(refused.retryAfterSec);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = (await res.json()) as { ok: boolean; error: { code: string; message: string } };
    expect(body).toEqual({ ok: false, error: { code: "RATE_LIMITED", message: ERROR_FA.RATE_LIMITED } });
  });
});
