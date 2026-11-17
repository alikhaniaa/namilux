import { createHmac, timingSafeEqual } from "node:crypto";
import type { SalesChannel } from "../channel";
import { appError } from "../errors";
import type { Quote } from "./quote";

export const QUOTE_TTL_MS = 600_000;

const HEX64_RE = /^[0-9a-f]{64}$/;

export type SignedQuoteFields = {
  /**
   * The storefront the quote was priced for. It is signed so a basket priced on one site can never
   * be placed on the other: the two sites list different amounts for the same product, and only the
   * channel tells `placeOrder` which gateway may settle it.
   */
  channel: SalesChannel;
  lines: { productId: number; qty: number; unitPrice: number }[];
  subtotal: number;
  discount: number;
  pointsDiscount: number;
  shipping: number;
  grandTotal: number;
  couponCode: string | null;
  pointsUsed: number;
  shippingKey: string | null;
  expiresAt: string;
};

export function signedFields(q: Quote): SignedQuoteFields {
  const lines = q.lines
    .filter((l) => l.status !== "removed")
    .map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice }))
    .sort((a, b) => a.productId - b.productId);
  const couponCode = q.coupon !== undefined && "code" in q.coupon ? q.coupon.code : null;
  return {
    channel: q.channel,
    lines,
    subtotal: q.subtotal,
    discount: q.discount,
    pointsDiscount: q.pointsDiscount,
    shipping: q.shipping,
    grandTotal: q.grandTotal,
    couponCode,
    pointsUsed: q.points?.used ?? 0,
    shippingKey: q.shippingKey,
    expiresAt: q.expiresAt,
  };
}

export function canonicalQuotePayload(q: Quote): string {
  const f = signedFields(q);
  // Key order is fixed here and never relies on the input object's key order. Lines are compact
  // [productId, qty, unitPrice] tuples so the payload is stable and small.
  const payload = {
    channel: f.channel,
    lines: f.lines.map((l) => [l.productId, l.qty, l.unitPrice]),
    subtotal: f.subtotal,
    discount: f.discount,
    pointsDiscount: f.pointsDiscount,
    shipping: f.shipping,
    grandTotal: f.grandTotal,
    couponCode: f.couponCode,
    pointsUsed: f.pointsUsed,
    shippingKey: f.shippingKey,
    expiresAt: f.expiresAt,
  };
  // v2 - the channel joined the payload with the second storefront. The version is inside the
  // signed string, so a v1 signature simply stops verifying rather than being reinterpreted.
  return `v2|${JSON.stringify(payload)}`;
}

export function signQuote(q: Quote, key: string): string {
  if (key === "") throw appError("INTERNAL", { details: "QUOTE_SIGNING_KEY is not configured" });
  return createHmac("sha256", key).update(canonicalQuotePayload(q)).digest("hex");
}

export function verifyQuoteSig(q: Quote, sig: string, key: string, now?: Date): boolean {
  if (!HEX64_RE.test(sig)) return false;
  if (key === "") return false;
  const expected = Buffer.from(signQuote(q, key), "hex");
  const given = Buffer.from(sig, "hex");
  const match = expected.length === given.length && timingSafeEqual(expected, given);
  // A valid signature on a stale quote must never pass (the spec TTL).
  if (isQuoteExpired(q, now)) return false;
  return match;
}

export function isQuoteExpired(q: Pick<Quote, "expiresAt">, now?: Date): boolean {
  const at = Date.parse(q.expiresAt);
  if (Number.isNaN(at)) return true;
  return at <= (now?.getTime() ?? Date.now());
}

export function quoteExpiresAt(now?: Date): string {
  return new Date((now?.getTime() ?? Date.now()) + QUOTE_TTL_MS).toISOString();
}
