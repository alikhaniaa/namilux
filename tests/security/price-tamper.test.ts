import { describe, expect, it } from "vitest";
import { signQuote, verifyQuoteSig } from "@namilux/core";
import type { Quote } from "@namilux/core";

const KEY = "k".repeat(64);
function quote(): Quote {
  return {
    lines: [{ productId: 1, name: "x", image: null, unitPrice: 1_000_000, compareAt: null, qty: 2, lineTotal: 2_000_000, status: "ok", available: 5 }],
    subtotal: 2_000_000, couponAmount: 0, discount: 0, pointsDiscount: 0, shipping: 0, grandTotal: 2_000_000,
    freeShipping: true, shippingKey: "free", shippingOptions: [], coupon: undefined, warnings: [],
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  } as unknown as Quote;
}

describe("security/price-tamper - signed quote", () => {
  it("a valid signature verifies; a tampered total does not", () => {
    const q = quote();
    const sig = signQuote(q, KEY);
    expect(verifyQuoteSig(q, sig, KEY)).toBe(true);
    const tampered = { ...q, grandTotal: 1 };
    expect(verifyQuoteSig(tampered, sig, KEY)).toBe(false);
  });
  it("a signature from another key does not verify", () => {
    const q = quote();
    expect(verifyQuoteSig(q, signQuote(q, "z".repeat(64)), KEY)).toBe(false);
  });
});
