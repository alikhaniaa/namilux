import { randomBytes } from "node:crypto";
import type { PaymentDriver } from "./types";

export const MOCK_AUTHORITY_PREFIX = "MOCK-";

/** Authorities minted ending in "-FAIL" verify as failed (drives the e2e failure path). */
export function mockVerifyOutcome(authority: string): "ok" | "fail" {
  return authority.endsWith("-FAIL") ? "fail" : "ok";
}

export function mockDriver(cfg: { siteOrigin: string }): PaymentDriver {
  return {
    key: "mock",
    /** The simulator stands in for both gateways, so every basket is offered instalments. */
    async eligible() {
      return { ok: true };
    },
    async request(o) {
      const authority = `${MOCK_AUTHORITY_PREFIX}${randomBytes(12).toString("hex")}`;
      // The gateway simulator page bounces back to /api/payment/callback/mock with Status OK/NOK.
      const redirectUrl = `${cfg.siteOrigin}/billing/gateway-sim/?authority=${encodeURIComponent(authority)}&order=${encodeURIComponent(o.orderCode)}`;
      return { ok: true, authority, redirectUrl };
    },
    async verify(o) {
      if (mockVerifyOutcome(o.authority) === "fail") return { ok: false, code: -51 };
      // Exercise the two-phase checkout on the main site. The mock settles inline; its durable
      // recovery job becomes a no-op after success.
      return { ok: true, refId: `MOCKREF-${o.authority.slice(-8)}`, alreadyVerified: false, needsSettle: true };
    },
    /** Simulated capture: immediate and always successful. */
    async settle() {
      return { ok: true };
    },
    /**
     * Simulated refund, so the admin's «بازپرداخت» button has a working path in dev and on a
     * staging box (the one environment that still tolerates PAYMENT_DRIVER=mock). Without it the
     * refund screen offered a gateway option that always answered «درگاه از بازپرداخت پشتیبانی
     * نمی‌کند», and the flow could not be rehearsed before the real gateway went live. Partial
     * refunds are allowed, matching SnappPay's partial update support.
     */
    async refund(o) {
      return { ok: true, ref: `MOCKRFND-${o.refId.slice(-8)}-${o.amount}` };
    },
  };
}
