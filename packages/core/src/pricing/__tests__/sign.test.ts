import { describe, expect, it } from "vitest";
import type { Quote, QuoteLine } from "../quote";
import {
  QUOTE_TTL_MS,
  canonicalQuotePayload,
  isQuoteExpired,
  quoteExpiresAt,
  signQuote,
  verifyQuoteSig,
} from "../sign";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function line(productId: number, qty: number, unitPrice: number): QuoteLine {
  return {
    productId,
    name: `کالای ${productId}`,
    image: null,
    unitPrice,
    qty,
    lineTotal: unitPrice * qty,
    available: 99,
    status: "ok",
  };
}

/** A fixture quote, five minutes from expiry, with two live lines and a removed one. */
function fixture(): Quote {
  return {
    channel: "main",
    lines: [
      line(2, 1, 5_000_000),
      line(1, 2, 41_500_000),
      { ...line(9, 0, 1_000), status: "removed", lineTotal: 0 },
    ],
    subtotal: 88_000_000,
    discount: 3_000_000,
    pointsDiscount: 500_000,
    shipping: 0,
    grandTotal: 84_500_000,
    coupon: { code: "WELCOME", kind: "fixed", amount: 3_000_000 },
    points: { available: 1_000_000, used: 500_000, value: 500_000 },
    shippingKey: "free_nationwide",
    shippingOptions: [],
    warnings: [],
    sig: "",
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
}

function signed(): Quote {
  const q = fixture();
  return { ...q, sig: signQuote(q, KEY) };
}

const clone = (q: Quote): Quote => structuredClone(q);

describe("pricing/sign - tamper cases", () => {
  it("sign → verify returns true on the same quote", () => {
    const q = signed();
    expect(verifyQuoteSig(q, q.sig, KEY)).toBe(true);
  });

  it("reordering lines with the same content still verifies", () => {
    const q = signed();
    const r = clone(q);
    r.lines = [r.lines[1]!, r.lines[2]!, r.lines[0]!];
    expect(verifyQuoteSig(r, q.sig, KEY)).toBe(true);
  });

  it("changing a line qty → false", () => {
    const q = signed();
    const r = clone(q);
    r.lines[0]!.qty = 3;
    expect(verifyQuoteSig(r, q.sig, KEY)).toBe(false);
  });

  it("changing a line unitPrice → false", () => {
    const q = signed();
    const r = clone(q);
    r.lines[0]!.unitPrice = 1;
    expect(verifyQuoteSig(r, q.sig, KEY)).toBe(false);
  });

  it("adding a line → false; removing a line → false", () => {
    const q = signed();
    const added = clone(q);
    added.lines.push(line(5, 1, 10));
    expect(verifyQuoteSig(added, q.sig, KEY)).toBe(false);
    const removed = clone(q);
    removed.lines.splice(0, 1);
    expect(verifyQuoteSig(removed, q.sig, KEY)).toBe(false);
  });

  it("changing grandTotal by 1 Toman → false", () => {
    const q = signed();
    const r = clone(q);
    r.grandTotal += 1;
    expect(verifyQuoteSig(r, q.sig, KEY)).toBe(false);
  });

  it("changing subtotal, discount, pointsDiscount or shipping → false", () => {
    const q = signed();
    for (const k of ["subtotal", "discount", "pointsDiscount", "shipping"] as const) {
      const r = clone(q);
      r[k] += 1;
      expect(verifyQuoteSig(r, q.sig, KEY)).toBe(false);
    }
  });

  it("changing couponCode between null and 'X' → false", () => {
    const q = signed();
    const r = clone(q);
    r.coupon = { code: "OTHER", kind: "fixed", amount: 3_000_000 };
    expect(verifyQuoteSig(r, q.sig, KEY)).toBe(false);
    const gone = clone(q);
    delete gone.coupon;
    expect(verifyQuoteSig(gone, q.sig, KEY)).toBe(false);
  });

  it("changing pointsUsed → false", () => {
    const q = signed();
    const r = clone(q);
    r.points!.used = 0;
    expect(verifyQuoteSig(r, q.sig, KEY)).toBe(false);
  });

  it("changing shippingKey → false", () => {
    const q = signed();
    const r = clone(q);
    r.shippingKey = "express_tehran";
    expect(verifyQuoteSig(r, q.sig, KEY)).toBe(false);
  });

  it("changing expiresAt, even to a later time → false", () => {
    const q = signed();
    const r = clone(q);
    r.expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    expect(verifyQuoteSig(r, q.sig, KEY)).toBe(false);
  });

  it("changing a line name/image or the warnings array → still true (not signed)", () => {
    const q = signed();
    const r = clone(q);
    r.lines[0]!.name = "دستکاری‌شده";
    r.lines[0]!.image = "x.jpg";
    r.warnings = [{ kind: "removed", productId: 9, reason: "out_of_stock" }];
    expect(verifyQuoteSig(r, q.sig, KEY)).toBe(true);
  });

  it("wrong key → false; empty key → signQuote throws INTERNAL", () => {
    const q = signed();
    expect(verifyQuoteSig(q, q.sig, "f".repeat(64))).toBe(false);
    expect(() => signQuote(q, "")).toThrow();
  });

  it("sig truncated to 63, padded to 65, empty or non-hex → false without throwing", () => {
    const q = signed();
    expect(verifyQuoteSig(q, q.sig.slice(0, 63), KEY)).toBe(false);
    expect(verifyQuoteSig(q, q.sig + "0", KEY)).toBe(false);
    expect(verifyQuoteSig(q, "", KEY)).toBe(false);
    expect(verifyQuoteSig(q, "z".repeat(64), KEY)).toBe(false);
  });

  it("expired quote (expiresAt 1 ms in the past) with a correct sig → false and isQuoteExpired true", () => {
    const q = fixture();
    q.expiresAt = new Date(Date.now() - 1).toISOString();
    const sig = signQuote(q, KEY);
    expect(verifyQuoteSig(q, sig, KEY)).toBe(false);
    expect(isQuoteExpired(q)).toBe(true);
  });

  it("quoteExpiresAt(now) parses to now + 600 000 ms", () => {
    const now = new Date("2026-08-27T00:00:00.000Z");
    expect(Date.parse(quoteExpiresAt(now))).toBe(now.getTime() + QUOTE_TTL_MS);
  });

  it("canonicalQuotePayload is independent of input key order (shuffled keys sign identically)", () => {
    const a = fixture();
    // Rebuild with a deliberately different key insertion order.
    const b: Quote = {
      expiresAt: a.expiresAt,
      channel: a.channel,
      sig: "",
      warnings: [],
      shippingOptions: [],
      shippingKey: a.shippingKey,
      grandTotal: a.grandTotal,
      shipping: a.shipping,
      pointsDiscount: a.pointsDiscount,
      discount: a.discount,
      subtotal: a.subtotal,
      lines: a.lines,
      ...(a.coupon ? { coupon: a.coupon } : {}),
      ...(a.points ? { points: a.points } : {}),
    };
    expect(canonicalQuotePayload(a)).toBe(canonicalQuotePayload(b));
  });
});
