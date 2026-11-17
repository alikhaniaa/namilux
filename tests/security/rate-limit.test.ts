import { describe, expect, it } from "vitest";
import { ERROR_FA } from "@namilux/core";
import { LIMITS } from "@/lib/ratelimit";

const BASE = (process.env["E2E_BASE_URL"] ?? "").replace(/\/$/, "");

/** the spec - tokens per window (seconds). */
const DOC: Record<string, { tokens: number; perSec: number }> = {
  "otp.request.ip": { tokens: 20, perSec: 600 },
  "otp.verify.ip": { tokens: 30, perSec: 600 },
  me: { tokens: 60, perSec: 60 },
  "checkout.quote": { tokens: 60, perSec: 60 },
  "checkout.place.customer": { tokens: 5, perSec: 600 },
  "checkout.place.ip": { tokens: 10, perSec: 600 },
  "returns.customer": { tokens: 5, perSec: 86_400 },
  "questions.customer": { tokens: 10, perSec: 86_400 },
  "contact.ip": { tokens: 5, perSec: 600 },
  "beacon.ip": { tokens: 120, perSec: 60 },
};

describe("rate limits", () => {
  it("limits table matches the spec", () => {
    for (const [key, spec] of Object.entries(DOC)) {
      expect(LIMITS[key], key).toEqual(spec);
    }
    for (const [key, spec] of Object.entries(LIMITS)) {
      expect(spec.tokens, key).toBeGreaterThan(0);
      expect(spec.perSec, key).toBeGreaterThan(0);
    }
  });

  describe.skipIf(BASE === "")("live", () => {
    it("429 carries Retry-After and the Persian message", async () => {
      // POST /api/contact is limited per IP (contact.ip). A dev server (APP_ENV=dev) scales every
      // bucket ×50 (lib/ratelimit.ts), so up to ~250 calls are needed before the 429; against a
      // staging or production origin the 5 of the table are spent after five.
      let last: Response | undefined;
      for (let i = 0; i < 320; i += 1) {
        last = await fetch(`${BASE}/api/contact/`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" },
          body: JSON.stringify({ name: "آزمون", phone: "09121234567", message: "پیام آزمایشی برای سنجش محدودیت نرخ", powToken: "invalid" }),
        });
        if (last.status === 429) break;
      }
      expect(last?.status).toBe(429);
      expect(Number(last?.headers.get("retry-after"))).toBeGreaterThan(0);
      const body = (await last?.json()) as { ok: boolean; error: { code: string; message: string } };
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("RATE_LIMITED");
      expect(body.error.message).toBe(ERROR_FA.RATE_LIMITED);
      expect(body.error.message).not.toMatch(/[0-9]/);
    }, 180_000);

    it("URL over 2 KB → 414; disallowed method → 405", async () => {
      const long = await fetch(`${BASE}/shop/?q=${"a".repeat(2_100)}`, { redirect: "manual" });
      expect(long.status).toBe(414);
      const method = await fetch(`${BASE}/shop/`, { method: "PATCH", redirect: "manual" });
      expect(method.status).toBe(405);
      expect(method.headers.get("allow") ?? "").toContain("GET");
      const head = await fetch(`${BASE}/shop/`, { method: "HEAD", redirect: "manual" });
      expect(head.status).toBeLessThan(400);
    });
  });
});
