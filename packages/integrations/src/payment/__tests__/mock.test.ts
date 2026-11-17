import { describe, expect, it } from "vitest";
import { MOCK_AUTHORITY_PREFIX, mockDriver, mockVerifyOutcome } from "../mock";
import { paymentDrivers } from "../registry";

describe("mock payment driver", () => {
  it("redirect stays within site scope", async () => {
    const d = mockDriver({ siteOrigin: "http://localhost:3000" });
    const r = await d.request({ amount: 41_500_000, description: "سفارش NL-7Q2F4", callbackUrl: "http://localhost:3000/api/payment/callback/mock", orderCode: "NL-7Q2F4" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.redirectUrl.startsWith("http://localhost:3000/billing/gateway-sim/")).toBe(true);
      expect(r.authority.startsWith(MOCK_AUTHORITY_PREFIX)).toBe(true);
      expect(r.redirectUrl).toContain(encodeURIComponent(r.authority));
    }
  });

  it("verify ok for minted authority", async () => {
    const d = mockDriver({ siteOrigin: "http://localhost:3000" });
    const req = await d.request({ amount: 1, description: "x", callbackUrl: "http://localhost:3000/cb", orderCode: "NL-AAAAA" });
    if (!req.ok) throw new Error("request failed");
    const v = await d.verify({ amount: 1, authority: req.authority });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.refId.startsWith("MOCKREF-")).toBe(true);
      expect(v.alreadyVerified).toBe(false);
    }
  });

  it("-FAIL authority fails", async () => {
    const d = mockDriver({ siteOrigin: "http://localhost:3000" });
    expect(mockVerifyOutcome("MOCK-abc-FAIL")).toBe("fail");
    const v = await d.verify({ amount: 1, authority: "MOCK-abc-FAIL" });
    expect(v).toEqual({ ok: false, code: -51 });
  });

  it("stands in for the instalment gateway: always eligible, settles at once", async () => {
    const d = mockDriver({ siteOrigin: "http://localhost:3000" });
    expect(await d.eligible?.({ amount: 100 })).toEqual({ ok: true });
    const req = await d.request({ amount: 1, description: "x", callbackUrl: "http://localhost:3000/cb", orderCode: "NL-AAAAA" });
    if (!req.ok) throw new Error("request failed");
    const v = await d.verify({ amount: 1, authority: req.authority });
    // needsSettle drives the two-phase path in handleCallback; the settle below always succeeds, so
    // the simulator never leaves a payment.settle job behind.
    expect(v.ok && v.needsSettle).toBe(true);
    expect(await d.settle?.({ authority: req.authority })).toEqual({ ok: true });
    // No `reverse`: the simulator holds nothing, so a failed callback has nothing to hand back.
    expect(typeof d.reverse).toBe("undefined");
  });

  it("refuses to load in prod", () => {
    expect(() => paymentDrivers({ PAYMENT_DRIVER: "mock", SITE_ORIGIN: "https://namilux.ir", APP_ENV: "prod" })).toThrow(/production/);
    const drivers = paymentDrivers({ PAYMENT_DRIVER: "zarinpal", ZARINPAL_MERCHANT_ID: "m", SITE_ORIGIN: "https://namilux.ir", APP_ENV: "prod" });
    expect(() => drivers.payment("mock")).toThrow(/production/);
  });
});
